var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { EventEmitter } from 'events';
import { Encoder, Decoder } from '@msgpack/msgpack';
import { DCMessageType, DCMessageCodecSupportMapDefault, CodecSupportLevel, CodecMimeType, } from './types';
import { encodeDCMsg, decodeDCMsg } from './dc_msg';
import { isFirefox, sleep } from './utils';
const rtcConnFailedErr = new Error('rtc connection failed');
const rtcConnTimeoutMsDefault = 15 * 1000;
const pingIntervalMs = 1000;
const signalingLockTimeoutMs = 5000;
export const signalingLockCheckIntervalMs = 50;
var SimulcastLevel;
(function (SimulcastLevel) {
    SimulcastLevel["High"] = "h";
    SimulcastLevel["Medium"] = "m";
    SimulcastLevel["Low"] = "l";
})(SimulcastLevel || (SimulcastLevel = {}));
const DefaultSimulcastScreenEncodings = [
    { rid: SimulcastLevel.Low, maxBitrate: 500 * 1000, maxFramerate: 5, scaleResolutionDownBy: 1.0 },
    { rid: SimulcastLevel.High, maxBitrate: 2500 * 1000, maxFramerate: 20, scaleResolutionDownBy: 1.0 },
];
const FallbackScreenEncodings = [
    { maxBitrate: 1000 * 1000, maxFramerate: 10, scaleResolutionDownBy: 1.0 },
];
export class RTCPeer extends EventEmitter {
    constructor(config) {
        super();
        this.dcNegotiated = false;
        this.dcLockResponseCb = null;
        this.rtt = 0;
        this.lastPingTS = 0;
        this.makingOffer = false;
        this.candidates = [];
        this.mediaMap = {};
        this.codecSupportMap = DCMessageCodecSupportMapDefault;
        this.config = config;
        this.logger = config.logger;
        // We keep a map of track IDs -> TrackContext in order to dynamically switch
        // encoders as receivers codec support varies in a call.
        this.trackCtxs = {};
        this.pc = new RTCPeerConnection(config);
        // As of MM-63776 we don't set pc.onnegotiationneeded since
        // it makes it much harder to ensure negotiations happen under signaling lock.
        // This means that this.onNegotiationNeeded() must be called manually (see addTrack for an example).
        this.pc.onicecandidate = (ev) => this.onICECandidate(ev);
        this.pc.oniceconnectionstatechange = () => this.onICEConnectionStateChange();
        this.pc.onconnectionstatechange = () => this.onConnectionStateChange();
        this.pc.ontrack = (ev) => this.onTrack(ev);
        this.enc = new Encoder();
        this.dec = new Decoder();
        this.connected = false;
        const connTimeout = config.connTimeoutMs || rtcConnTimeoutMsDefault;
        this.connTimeoutID = setTimeout(() => {
            if (!this.connected) {
                this.emit('error', 'timed out waiting for rtc connection');
            }
        }, connTimeout);
        // We create a data channel for two reasons:
        // - Initiate a connection without preemptively adding audio/video tracks.
        // - Calculate transport latency through simple ping/pong sequences.
        // - Use this communication channel for further negotiation (to be implemented).
        this.dc = this.pc.createDataChannel('calls-dc');
        this.dc.binaryType = 'arraybuffer';
        this.dc.onmessage = (ev) => this.dcHandler(ev);
        this.pingIntervalID = this.initPingHandler();
        this.logger.logDebug('RTCPeer: created new client', JSON.stringify(config));
        this.onNegotiationNeeded().catch((err) => {
            this.logger.logErr('RTCPeer: onNegotiationNeeded failed', err);
        });
    }
    dcHandler(ev) {
        var _a;
        try {
            const { mt, payload } = decodeDCMsg(this.dec, ev.data);
            switch (mt) {
                case DCMessageType.Pong:
                    if (this.lastPingTS > 0) {
                        this.rtt = (performance.now() - this.lastPingTS) / 1000;
                    }
                    break;
                case DCMessageType.SDP:
                    this.logger.logDebug('RTCPeer.dcHandler: received sdp dc message');
                    this.signal(payload).catch((err) => {
                        this.logger.logErr('RTCPeer.dcHandler: failed to signal sdp, unlocking', err);
                        return this.unlockSignalingLock();
                    });
                    break;
                case DCMessageType.Lock:
                    this.logger.logDebug('RTCPeer.dcHandler: received lock response', payload);
                    (_a = this.dcLockResponseCb) === null || _a === void 0 ? void 0 : _a.call(this, payload);
                    break;
                case DCMessageType.MediaMap:
                    this.logger.logDebug('RTCPeer.dcHandler: received media map dc message', payload);
                    this.mediaMap = payload;
                    break;
                case DCMessageType.CodecSupportMap:
                    this.logger.logDebug('RTCPeer.dcHandler: received codec support map dc message', payload);
                    this.codecSupportMap = payload;
                    this.logger.logDebug('RTCPeer.dcHandler: codec support map: grabbing signaling lock');
                    // We don't want to block this function since it's paramount to handle negotiation and locking responses.
                    this.grabSignalingLock(signalingLockTimeoutMs).then(() => this.handleCodecSupportUpdate(this.codecSupportMap)).then((needsNegotiation) => {
                        this.logger.logDebug('RTCPeer.dcHandler: codec support update handled', needsNegotiation);
                        if (!needsNegotiation) {
                            this.logger.logDebug('RTCPeer.handleCodecSupportUpdate: no negotiation needed, unlocking');
                            this.unlockSignalingLock();
                        }
                    }).catch((err) => {
                        this.logger.logErr('RTCPeer.dcHandler: failed to handle codec support update, unlocking', err);
                        this.unlockSignalingLock();
                    });
                    break;
                default:
                    this.logger.logWarn(`RTCPeer.dcHandler: unexpected dc message type ${mt}`);
            }
        }
        catch (err) {
            this.logger.logErr('failed to decode dc message', err);
        }
    }
    switchCodecForTrack(tctx, targetCodec) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            // First, we stop sending the track with the current codec.
            // This is to ensure we are only sending one encoding at any given time.
            // Replacing the track this way also allows us to quickly start sending again
            // if support changes during the call (e.g. the only unsupported client leaves).
            yield tctx.sender.replaceTrack(null);
            // Check if we already have a sender with the target codec that can be reused. This avoids having to add a new track (and transceiver)
            // every time we need to switch codecs. Once we switched once we should have both VP8 and AV1 senders available.
            const existingSender = (_a = this.pc) === null || _a === void 0 ? void 0 : _a.getSenders().find((s) => {
                var _a;
                const params = s.getParameters();
                return s.track === null && ((_a = params.codecs) === null || _a === void 0 ? void 0 : _a.length) > 0 && params.codecs[0].mimeType === targetCodec.mimeType;
            });
            if (existingSender) {
                this.logger.logDebug(`RTCPeer.switchCodecForTrack: ${targetCodec.mimeType} sender already exists, replacing track`, existingSender, tctx);
                yield existingSender.replaceTrack(tctx.track);
                this.trackCtxs[tctx.track.id] = Object.assign(Object.assign({}, tctx), { sender: existingSender });
            }
            else {
                // Prepare options with the target codec
                const opts = Object.assign(Object.assign({}, tctx.opts), { 
                    // It's important we force the codec here, otherwise the server side may just answer
                    // saying it's okay what we are sending already :)
                    codecs: [targetCodec] });
                this.logger.logDebug(`RTCPeer.switchCodecForTrack: ${targetCodec.mimeType} sender does not exist, adding new track`, opts, tctx);
                // We are under signaling lock here, so must call the non-locked method for adding a new track.
                yield this.addTrackNoLock(tctx.track, tctx.stream, opts);
            }
        });
    }
    // handleCodecSupportUpdate is called when the codec support map is received from the server.
    // It returns a boolean indicating whether renegotiation is needed, in which case we shouldn't
    // unlock the signaling lock.
    handleCodecSupportUpdate(supportMap) {
        return __awaiter(this, void 0, void 0, function* () {
            // We'll keep this simple as we only need to handle VP8<->AV1 transitions for the time being.
            // A more generic solution can be implemented later if needed.
            var _a, _b;
            // First we to check whether the client can send AV1, otherwise there's no point continuing.
            const av1Codec = yield RTCPeer.getVideoCodec(CodecMimeType.AV1);
            if (!av1Codec) {
                this.logger.logDebug('RTCPeer.handleCodecSupportUpdate: client does not support AV1 codec, returning');
                return false;
            }
            const vp8Codec = yield RTCPeer.getVideoCodec(CodecMimeType.VP8);
            if (!vp8Codec) {
                // Realistically, this should never happen.
                this.logger.logErr('RTCPeer.handleCodecSupportUpdate: client does not support VP8 codec, returning');
                return false;
            }
            // Second, we check AV1 support level of the call. Partial or None levels are treated the same as we don't want to send
            // multiple encodings at the same time. This means we need full support to send an AV1-encoded track.
            const av1CallSupport = supportMap[CodecMimeType.AV1] === CodecSupportLevel.Full;
            // Now we check whether we need to make any changes to our encodings for outgoing tracks (senders).
            // If av1CallSupport is true, we need to ensure that we are sending AV1 (if we are sending any video tracks that is)
            // Else, if av1CallSupport is false, we need to ensure we are sending video tracks using VP8 and switch codec where necessary.
            const targetCodec = av1CallSupport ? av1Codec : vp8Codec;
            let needsNegotiation = false;
            for (const tctx of Object.values(this.trackCtxs)) {
                if (((_a = tctx.sender.track) === null || _a === void 0 ? void 0 : _a.kind) !== 'video') {
                    // Skip non-video tracks.
                    continue;
                }
                this.logger.logDebug(`RTCPeer.handleCodecSupportUpdate: av1CallSupport=${av1CallSupport} checking video sender`, tctx);
                const params = tctx.sender.getParameters();
                const currentCodec = params.codecs[0];
                // Only switch if we're not already sending the track using the target codec.
                if (currentCodec.mimeType !== targetCodec.mimeType) {
                    this.logger.logDebug(`RTCPeer.handleCodecSupportUpdate: ${targetCodec.mimeType} codec not used for video sender, need to switch encoder to ${targetCodec.mimeType}`, av1CallSupport, currentCodec, tctx);
                    // eslint-disable-next-line no-await-in-loop
                    yield this.switchCodecForTrack(tctx, targetCodec);
                    needsNegotiation = true;
                }
            }
            const existingTransceiver = (_b = this.pc) === null || _b === void 0 ? void 0 : _b.getTransceivers().find((trx) => {
                var _a;
                if (!trx.receiver) {
                    return false;
                }
                return trx.receiver.track && ((_a = this.mediaMap[trx.mid]) === null || _a === void 0 ? void 0 : _a.mime_type) === targetCodec.mimeType;
            });
            if (existingTransceiver) {
                this.logger.logDebug(`RTCPeer.handleCodecSupportUpdate: ${targetCodec.mimeType} receiver already exists, need to emit track`, existingTransceiver, existingTransceiver.receiver.track);
                this.emit('stream', new MediaStream([existingTransceiver.receiver.track]), this.mediaMap[existingTransceiver.mid]);
            }
            if (needsNegotiation) {
                yield this.onNegotiationNeeded();
            }
            return needsNegotiation;
        });
    }
    initPingHandler() {
        return setInterval(() => {
            if (this.dc.readyState !== 'open') {
                return;
            }
            this.lastPingTS = performance.now();
            this.dc.send(encodeDCMsg(this.enc, DCMessageType.Ping));
        }, pingIntervalMs);
    }
    getRTT() {
        if (!this.pc) {
            throw new Error('peer has been destroyed');
        }
        return this.rtt;
    }
    onICECandidate(ev) {
        if (ev.candidate) {
            this.logger.logDebug('RTCPeer.onICECandidate: local candidate', JSON.stringify(ev.candidate));
            this.emit('candidate', ev.candidate);
        }
    }
    onConnectionStateChange() {
        var _a, _b;
        this.logger.logDebug(`RTCPeer: connection state change -> ${(_a = this.pc) === null || _a === void 0 ? void 0 : _a.connectionState}`);
        switch ((_b = this.pc) === null || _b === void 0 ? void 0 : _b.connectionState) {
            case 'connected':
                if (!this.connected) {
                    clearTimeout(this.connTimeoutID);
                    this.connected = true;
                    this.emit('connect');
                }
                break;
            case 'closed':
                this.emit('close');
                break;
            case 'failed':
                this.emit('close', rtcConnFailedErr);
                break;
        }
    }
    onICEConnectionStateChange() {
        var _a;
        this.logger.logDebug(`RTCPeer: ICE connection state change -> ${(_a = this.pc) === null || _a === void 0 ? void 0 : _a.iceConnectionState}`);
    }
    enqueueLockMsg() {
        setTimeout(() => {
            if (this.dc.readyState === 'closed' || this.dc.readyState === 'closing') {
                // Avoid requeuing if the data channel is closed or closing. This will eventually result in a timeout.
                this.logger.logDebug('RTCPeer.enqueueLockMsg: dc closed or closing, returning');
                return;
            }
            if (!this.dcNegotiated || this.dc.readyState !== 'open') {
                this.logger.logDebug('RTCPeer.enqueueLockMsg: dc not negotiated or not open, requeing');
                this.enqueueLockMsg();
                return;
            }
            this.dc.send(encodeDCMsg(this.enc, DCMessageType.Lock));
        }, signalingLockCheckIntervalMs);
    }
    grabSignalingLock(timeoutMs) {
        const start = performance.now();
        return new Promise((resolve, reject) => {
            // The attemptLock wrapper is needed since Promise executor should be synchronous.
            const attemptLock = () => __awaiter(this, void 0, void 0, function* () {
                // This covers the case of "concurrent" (interleaved in practice) attempts to lock
                // which would otherwise result in this.dcLockResponseCb getting overwritten.
                // Waiting ensures lock attempts are all done fully serially.
                while (this.dcLockResponseCb) {
                    if ((performance.now() - start) > timeoutMs) {
                        throw new Error('timed out waiting for lock');
                    }
                    this.logger.logDebug(`RTCPeer.grabSignalingLock: already waiting for lock, retrying in ${signalingLockCheckIntervalMs}ms`);
                    // eslint-disable-next-line no-await-in-loop
                    yield sleep(signalingLockCheckIntervalMs);
                }
                this.dcLockResponseCb = (acquired) => {
                    if (acquired) {
                        this.logger.logDebug(`RTCPeer.grabSignalingLock: lock acquired in ${Math.round(performance.now() - start)}ms`);
                        this.dcLockResponseCb = null;
                        resolve();
                    }
                    else {
                        this.enqueueLockMsg();
                    }
                };
                setTimeout(() => {
                    this.dcLockResponseCb = null;
                    reject(new Error('timed out waiting for lock'));
                }, timeoutMs);
                if (!this.dcNegotiated || this.dc.readyState !== 'open') {
                    this.logger.logDebug('RTCPeer.grabSignalingLock: dc not negotiated or not open, requeing');
                    this.enqueueLockMsg();
                    return;
                }
                this.dc.send(encodeDCMsg(this.enc, DCMessageType.Lock));
            });
            // Start the lock attempt
            attemptLock().catch((err) => reject(err));
        });
    }
    onNegotiationNeeded() {
        return __awaiter(this, void 0, void 0, function* () {
            // Closed client case.
            if (!this.pc) {
                return;
            }
            yield this.makeOffer();
        });
    }
    makeOffer() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            try {
                this.makingOffer = true;
                yield ((_a = this.pc) === null || _a === void 0 ? void 0 : _a.setLocalDescription());
                this.logger.logDebug('RTCPeer.makeOffer: generated local offer', JSON.stringify((_b = this.pc) === null || _b === void 0 ? void 0 : _b.localDescription));
                if (this.config.dcSignaling && this.dc.readyState === 'open') {
                    this.logger.logDebug('RTCPeer.makeOffer: connected, sending offer through data channel');
                    try {
                        this.dc.send(encodeDCMsg(this.enc, DCMessageType.SDP, (_c = this.pc) === null || _c === void 0 ? void 0 : _c.localDescription));
                    }
                    catch (err) {
                        this.logger.logErr('RTCPeer.makeOffer: failed to send on datachannel', err);
                    }
                }
                else {
                    if (this.config.dcSignaling) {
                        this.logger.logDebug('RTCPeer.makeOffer: dc not connected, emitting offer');
                    }
                    this.emit('offer', (_d = this.pc) === null || _d === void 0 ? void 0 : _d.localDescription);
                }
            }
            catch (err) {
                this.emit('error', err);
                this.logger.logErr('RTCPeer.makeOffer: failed to create offer, unlocking', err);
                this.unlockSignalingLock();
            }
            finally {
                this.makingOffer = false;
            }
        });
    }
    unlockSignalingLock() {
        if (this.dcNegotiated && this.dc.readyState === 'open') {
            this.logger.logDebug('RTCPeer.unlockSignalingLock: unlocking');
            this.dc.send(encodeDCMsg(this.enc, DCMessageType.Unlock));
        }
        else {
            this.logger.logWarn('RTCPeer.unlockSignalingLock: dc not negotiated or not open');
        }
    }
    onTrack(ev) {
        this.emit('stream', new MediaStream([ev.track]), this.mediaMap[ev.transceiver.mid]);
    }
    flushICECandidates() {
        var _a;
        this.logger.logDebug(`RTCPeer.flushICECandidates: flushing ${this.candidates.length} candidates`);
        for (const candidate of this.candidates) {
            this.logger.logDebug('RTCPeer.flushICECandidates: adding queued ice candidate');
            (_a = this.pc) === null || _a === void 0 ? void 0 : _a.addIceCandidate(candidate).catch((err) => {
                this.logger.logErr('RTCPeer.flushICECandidates: failed to add candidate', err);
            });
        }
        this.candidates = [];
    }
    signal(data) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (!this.pc) {
                throw new Error('peer has been destroyed');
            }
            this.logger.logDebug('RTCPeer.signal: handling remote signaling data', data);
            const msg = JSON.parse(data);
            if (msg.type === 'offer' && (this.makingOffer || ((_a = this.pc) === null || _a === void 0 ? void 0 : _a.signalingState) !== 'stable')) {
                this.logger.logDebug('RTCPeer.signal: signaling conflict, we are polite, proceeding...');
            }
            switch (msg.type) {
                case 'candidate':
                    // It's possible that ICE candidates are received moments before
                    // we set the initial remote description which would cause an
                    // error. In such case we queue them up to be added later.
                    if (this.pc.remoteDescription && this.pc.remoteDescription.type) {
                        this.pc.addIceCandidate(msg.candidate).catch((err) => {
                            this.logger.logErr('RTCPeer.signal: failed to add candidate', err);
                        });
                    }
                    else {
                        this.logger.logDebug('RTCPeer.signal: received ice candidate before remote description, queuing...');
                        this.candidates.push(msg.candidate);
                    }
                    break;
                case 'offer':
                    yield this.pc.setRemoteDescription(msg);
                    if (this.candidates.length > 0) {
                        this.flushICECandidates();
                    }
                    yield this.pc.setLocalDescription();
                    this.logger.logDebug('RTCPeer.signal: generated local answer', JSON.stringify(this.pc.localDescription));
                    if (this.config.dcSignaling && this.dc.readyState === 'open') {
                        this.logger.logDebug('connected, sending answer through data channel', this.pc.localDescription);
                        try {
                            this.dc.send(encodeDCMsg(this.enc, DCMessageType.SDP, this.pc.localDescription));
                        }
                        catch (err) {
                            this.logger.logErr('failed to send on datachannel', err);
                        }
                    }
                    else {
                        if (this.config.dcSignaling) {
                            this.logger.logDebug('dc not connected, emitting answer');
                        }
                        this.emit('answer', this.pc.localDescription);
                    }
                    break;
                case 'answer':
                    yield this.pc.setRemoteDescription(msg);
                    if (this.candidates.length > 0) {
                        this.flushICECandidates();
                    }
                    if (this.dcNegotiated) {
                        if (this.dc.readyState !== 'open') {
                            this.logger.logWarn('RTCPeer.signal: dc not open upon receiving answer');
                        }
                        this.logger.logDebug('RTCPeer.signal: handled remote answer, unlocking');
                        yield this.unlockSignalingLock();
                    }
                    else {
                        this.dcNegotiated = true;
                    }
                    break;
                default:
                    throw new Error('invalid signaling data received');
            }
        });
    }
    addTrackNoLock(track, stream, opts) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.pc) {
                throw new Error('peer has been destroyed');
            }
            let sender;
            if (track.kind === 'video') {
                // Simulcast
                // NOTE: Unfortunately Firefox cannot simulcast screen sharing tracks
                // properly (https://bugzilla.mozilla.org/show_bug.cgi?id=1692873).
                // TODO: check whether track is coming from screenshare when we
                // start supporting video.
                let sendEncodings = this.config.simulcast && !isFirefox() ? DefaultSimulcastScreenEncodings : FallbackScreenEncodings;
                if (opts === null || opts === void 0 ? void 0 : opts.encodings) {
                    sendEncodings = opts.encodings;
                }
                this.logger.logDebug('RTCPeer.addTrack: creating new transceiver on send');
                const trx = this.pc.addTransceiver(track, {
                    direction: 'sendrecv',
                    sendEncodings,
                    streams: [stream],
                });
                if (trx.setCodecPreferences) {
                    const vp8Codec = yield RTCPeer.getVideoCodec(CodecMimeType.VP8);
                    if (!vp8Codec) {
                        throw new Error('VP8 codec not found');
                    }
                    const codecs = [vp8Codec];
                    const av1Codec = yield RTCPeer.getVideoCodec(CodecMimeType.AV1);
                    if (av1Codec) {
                        codecs.push(av1Codec);
                    }
                    if (av1Codec && this.config.enableAV1 && this.codecSupportMap[CodecMimeType.AV1] === CodecSupportLevel.Full) {
                        this.logger.logDebug('RTCPeer.addTrack: AV1 enabled and full support in call, setting AV1 codec as preferred');
                        codecs.reverse();
                    }
                    this.logger.logDebug('RTCPeer.addTrack: setting video codec preference', codecs);
                    trx.setCodecPreferences(codecs);
                }
                sender = trx.sender;
            }
            else {
                // TODO: MM-63811, use transceiver API
                sender = yield this.pc.addTrack(track, stream);
            }
            this.trackCtxs[track.id] = {
                sender,
                stream,
                opts,
                track,
            };
        });
    }
    addTrack(track, stream, opts) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.pc) {
                throw new Error('peer has been destroyed');
            }
            this.logger.logDebug('RTCPeer.addTrack: grabbing signaling lock');
            // We need to acquire a signaling lock before we can proceed with adding the track.
            yield this.grabSignalingLock(signalingLockTimeoutMs);
            // Lock acquired, we can now proceed.
            this.logger.logDebug('RTCPeer.addTrack: signaling locked acquired');
            yield this.addTrackNoLock(track, stream, opts);
            yield this.onNegotiationNeeded();
        });
    }
    addStream(stream, opts) {
        return __awaiter(this, void 0, void 0, function* () {
            for (let idx = 0; idx < stream.getTracks().length; idx++) {
                const track = stream.getTracks()[idx];
                // We actually mean to block and add them in order.
                // eslint-disable-next-line no-await-in-loop
                yield this.addTrack(track, stream, opts === null || opts === void 0 ? void 0 : opts[idx]);
            }
        });
    }
    replaceTrack(oldTrackID, newTrack) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.pc) {
                throw new Error('peer has been destroyed');
            }
            // Since we expect replaceTrack not to cause a re-negotiation, locking is not required.
            const ctx = this.trackCtxs[oldTrackID];
            if (!ctx) {
                throw new Error('ctx for track not found');
            }
            if (newTrack && newTrack.id !== oldTrackID) {
                this.trackCtxs[newTrack.id] = Object.assign(Object.assign({}, this.trackCtxs[oldTrackID]), { track: newTrack });
                delete this.trackCtxs[oldTrackID];
            }
            yield ctx.sender.replaceTrack(newTrack);
        });
    }
    removeTrack(trackID) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.pc) {
                throw new Error('peer has been destroyed');
            }
            this.logger.logDebug('RTCPeer.removeTrack: grabbing signaling lock');
            // We need to acquire the signaling lock before we can proceed with removing the track.
            yield this.grabSignalingLock(signalingLockTimeoutMs);
            // Lock acquired, we can now proceed.
            this.logger.logDebug('RTCPeer.removeTrack: signaling locked acquired');
            const ctx = this.trackCtxs[trackID];
            if (!ctx) {
                throw new Error('ctx for track not found');
            }
            // TODO: MM-63811, use transceiver API
            yield this.pc.removeTrack(ctx.sender);
            delete this.trackCtxs[trackID];
            yield this.onNegotiationNeeded();
        });
    }
    getStats() {
        if (!this.pc) {
            throw new Error('peer has been destroyed');
        }
        return this.pc.getStats(null);
    }
    handleMetrics(lossRate, jitter) {
        try {
            if (lossRate >= 0) {
                this.dc.send(encodeDCMsg(this.enc, DCMessageType.LossRate, lossRate));
            }
            if (this.rtt > 0) {
                this.dc.send(encodeDCMsg(this.enc, DCMessageType.RoundTripTime, this.rtt));
            }
            if (jitter > 0) {
                this.dc.send(encodeDCMsg(this.enc, DCMessageType.Jitter, jitter));
            }
        }
        catch (err) {
            this.logger.logErr('failed to send metrics through dc', err);
        }
    }
    static getVideoCodec(mimeType) {
        return __awaiter(this, void 0, void 0, function* () {
            if (RTCRtpReceiver.getCapabilities) {
                const videoCapabilities = yield RTCRtpReceiver.getCapabilities('video');
                if (videoCapabilities) {
                    for (const codec of videoCapabilities.codecs) {
                        if (codec.mimeType === mimeType) {
                            return codec;
                        }
                    }
                }
            }
            return null;
        });
    }
    destroy() {
        if (!this.pc) {
            throw new Error('peer has been destroyed already');
        }
        this.removeAllListeners('candidate');
        this.removeAllListeners('connect');
        this.removeAllListeners('error');
        this.removeAllListeners('close');
        this.removeAllListeners('offer');
        this.removeAllListeners('answer');
        this.removeAllListeners('stream');
        this.pc.onicecandidate = null;
        this.pc.oniceconnectionstatechange = null;
        this.pc.onconnectionstatechange = null;
        this.pc.ontrack = null;
        this.pc.close();
        this.pc = null;
        this.connected = false;
        this.candidates = [];
        clearInterval(this.pingIntervalID);
        clearTimeout(this.connTimeoutID);
        this.dc.onmessage = null;
    }
}
