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
import { DCMessageType } from './types';
import { encodeDCMsg, decodeDCMsg } from './dc_msg';
import { isFirefox } from './utils';
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
        this.config = config;
        this.logger = config.logger;
        // We keep a map of track IDs -> RTP sender so that we can easily
        // replace tracks when muting/unmuting.
        this.senders = {};
        this.pc = new RTCPeerConnection(config);
        this.pc.onnegotiationneeded = () => this.onNegotiationNeeded();
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
                        this.logger.logErr('RTCPeer.dcHandler: failed to signal sdp', err);
                    });
                    break;
                case DCMessageType.Lock:
                    this.logger.logDebug('RTCPeer.dcHandler: received lock response', payload);
                    (_a = this.dcLockResponseCb) === null || _a === void 0 ? void 0 : _a.call(this, payload);
                    break;
                default:
                    this.logger.logWarn(`RTCPeer.dcHandler: unexpected dc message type ${mt}`);
            }
        }
        catch (err) {
            this.logger.logErr('failed to decode dc message', err);
        }
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
            this.dcLockResponseCb = (acquired) => {
                if (acquired) {
                    this.logger.logDebug(`RTCPeer.grabSignalingLock: lock acquired in ${Math.round(performance.now() - start)}ms`);
                    this.dcLockResponseCb = null;
                    resolve();
                    return;
                }
                // If we failed to acquire the lock we wait and try again. It likely means the server side is in the
                // process of sending us an offer (or we are).
                this.enqueueLockMsg();
            };
            setTimeout(() => {
                this.dcLockResponseCb = null;
                reject(new Error('timed out waiting for lock'));
            }, timeoutMs);
            // If we haven't fully negotiated the data channel or if this isn't ready yet we wait.
            if (!this.dcNegotiated || this.dc.readyState !== 'open') {
                this.logger.logDebug('RTCPeer.grabSignalingLock: dc not negotiated or not open, requeing');
                this.enqueueLockMsg();
                return;
            }
            this.dc.send(encodeDCMsg(this.enc, DCMessageType.Lock));
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
                if (this.dcNegotiated && this.dc.readyState === 'open') {
                    this.logger.logErr('RTCPeer.makeOffer: unlocking on error');
                    this.dc.send(encodeDCMsg(this.enc, DCMessageType.Unlock));
                }
            }
            finally {
                this.makingOffer = false;
            }
        });
    }
    onTrack(ev) {
        if (this.pc && ev.track.kind === 'video') {
            // We force the transceiver direction of the incoming screen track
            // to be 'sendrecv' so Firefox stops complaining.
            // In practice the transceiver is only ever going to be used to
            // receive.
            for (const t of this.pc.getTransceivers()) {
                if (t.receiver && t.receiver.track === ev.track) {
                    if (t.direction !== 'sendrecv') {
                        this.logger.logDebug('RTCPeer.onTrack: setting transceiver direction for track');
                        t.direction = 'sendrecv';
                    }
                    break;
                }
            }
        }
        this.emit('stream', new MediaStream([ev.track]));
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
                    if (!this.dcNegotiated) {
                        this.dcNegotiated = true;
                    }
                    else if (this.dc.readyState === 'open') {
                        this.logger.logDebug('RTCPeer.signal: unlocking signaling lock');
                        this.dc.send(encodeDCMsg(this.enc, DCMessageType.Unlock));
                    }
                    else {
                        this.logger.logWarn('RTCPeer.signal: dc not open upon receiving answer');
                    }
                    break;
                default:
                    throw new Error('invalid signaling data received');
            }
        });
    }
    addTrack(track, stream, opts) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.pc) {
                throw new Error('peer has been destroyed');
            }
            // We need to acquire a signaling lock before we can proceed with adding the track.
            yield this.grabSignalingLock(signalingLockTimeoutMs);
            // Lock acquired, we can now proceed.
            this.logger.logDebug('RTCPeer.addTrack: signaling locked acquired');
            let sender;
            if (track.kind === 'video') {
                // Simulcast
                // NOTE: Unfortunately Firefox cannot simulcast screen sharing tracks
                // properly (https://bugzilla.mozilla.org/show_bug.cgi?id=1692873).
                // TODO: check whether track is coming from screenshare when we
                // start supporting video.
                this.logger.logDebug('RTCPeer.addTrack: creating new transceiver on send');
                const trx = this.pc.addTransceiver(track, {
                    direction: 'sendonly',
                    sendEncodings: this.config.simulcast && !isFirefox() ? DefaultSimulcastScreenEncodings : FallbackScreenEncodings,
                    streams: [stream],
                });
                if ((opts === null || opts === void 0 ? void 0 : opts.codec) && trx.setCodecPreferences) {
                    this.logger.logDebug('setting video codec preference', opts.codec);
                    trx.setCodecPreferences([opts.codec]);
                }
                sender = trx.sender;
            }
            else {
                sender = yield this.pc.addTrack(track, stream);
            }
            if (!this.senders[track.id]) {
                this.senders[track.id] = [];
            }
            this.senders[track.id].push(sender);
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
        if (!this.pc) {
            throw new Error('peer has been destroyed');
        }
        // Since we expect replaceTrack not to cause a re-negotiation, locking is not required.
        const senders = this.senders[oldTrackID];
        if (!senders) {
            throw new Error('senders for track not found');
        }
        if (newTrack && newTrack.id !== oldTrackID) {
            delete this.senders[oldTrackID];
            this.senders[newTrack.id] = senders;
        }
        for (const sender of senders) {
            sender.replaceTrack(newTrack);
        }
    }
    removeTrack(trackID) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.pc) {
                throw new Error('peer has been destroyed');
            }
            // We need to acquire the signaling lock before we can proceed with removing the track.
            yield this.grabSignalingLock(signalingLockTimeoutMs);
            // Lock acquired, we can now proceed.
            this.logger.logDebug('RTCPeer.removeTrack: signaling locked acquired');
            const senders = this.senders[trackID];
            if (!senders) {
                throw new Error('senders for track not found');
            }
            for (const sender of senders) {
                this.pc.removeTrack(sender);
            }
            delete this.senders[trackID];
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
        this.pc.onnegotiationneeded = null;
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
