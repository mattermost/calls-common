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
import { isFirefox, getFirefoxVersion } from './utils';
const rtcConnFailedErr = new Error('rtc connection failed');
const rtcConnTimeoutMsDefault = 15 * 1000;
const pingIntervalMs = 1000;
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
        this.rtt = 0;
        this.makingOffer = false;
        this.candidates = [];
        this.config = config;
        this.logger = config.logger;
        // use the provided webrtc methods (for mobile), or the build in lib.dom methods (for webapp)
        if (config.webrtc) {
            this.webrtc = config.webrtc;
        }
        else {
            this.webrtc = {
                MediaStream,
                RTCPeerConnection,
            };
        }
        // We keep a map of track IDs -> RTP sender so that we can easily
        // replace tracks when muting/unmuting.
        this.senders = {};
        this.pc = new this.webrtc.RTCPeerConnection(config);
        this.pc.onnegotiationneeded = () => this.onNegotiationNeeded();
        this.pc.onicecandidate = (ev) => this.onICECandidate(ev);
        this.pc.oniceconnectionstatechange = () => this.onICEConnectionStateChange();
        this.pc.onconnectionstatechange = () => this.onConnectionStateChange();
        this.pc.ontrack = (ev) => this.onTrack(ev);
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
        this.pingIntervalID = this.initPingHandler();
    }
    initPingHandler() {
        let pingTS = 0;
        this.dc.onmessage = ({ data }) => {
            if (data === 'pong' && pingTS > 0) {
                this.rtt = (performance.now() - pingTS) / 1000;
            }
        };
        return setInterval(() => {
            if (this.dc.readyState !== 'open') {
                return;
            }
            pingTS = performance.now();
            this.dc.send('ping');
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
    onNegotiationNeeded() {
        var _a, _b;
        return __awaiter(this, void 0, void 0, function* () {
            try {
                this.makingOffer = true;
                yield ((_a = this.pc) === null || _a === void 0 ? void 0 : _a.setLocalDescription());
                this.emit('offer', (_b = this.pc) === null || _b === void 0 ? void 0 : _b.localDescription);
            }
            catch (err) {
                this.emit('error', err);
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
        this.emit('stream', new this.webrtc.MediaStream([ev.track]));
    }
    signal(data) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.pc) {
                throw new Error('peer has been destroyed');
            }
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
                    yield this.pc.setLocalDescription();
                    this.emit('answer', this.pc.localDescription);
                    break;
                case 'answer':
                    yield this.pc.setRemoteDescription(msg);
                    for (const candidate of this.candidates) {
                        this.logger.logDebug('RTCPeer.signal: adding queued ice candidate');
                        this.pc.addIceCandidate(candidate).catch((err) => {
                            this.logger.logErr('RTCPeer.signal: failed to add candidate', err);
                        });
                    }
                    break;
                default:
                    throw new Error('invalid signaling data received');
            }
        });
    }
    addTrack(track, stream) {
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
                if (isFirefox() && getFirefoxVersion() < 110) {
                    // DEPRECATED: we should consider removing this as sendEncodings
                    // has been supported since v110.
                    sender = yield this.pc.addTrack(track, stream);
                    const params = yield sender.getParameters();
                    params.encodings = FallbackScreenEncodings;
                    yield sender.setParameters(params);
                    // We need to explicitly set the transceiver direction or Firefox
                    // will default to sendrecv which will cause problems when removing the track.
                    for (const trx of this.pc.getTransceivers()) {
                        if (trx.sender === sender) {
                            this.logger.logDebug('RTCPeer.addTrack: setting transceiver direction to sendonly');
                            trx.direction = 'sendonly';
                            break;
                        }
                    }
                }
                else {
                    this.logger.logDebug('RTCPeer.addTrack: creating new transceiver on send');
                    const trx = this.pc.addTransceiver(track, {
                        direction: 'sendonly',
                        sendEncodings: this.config.simulcast && !isFirefox() ? DefaultSimulcastScreenEncodings : FallbackScreenEncodings,
                        streams: [stream],
                    });
                    sender = trx.sender;
                }
            }
            else {
                sender = yield this.pc.addTrack(track, stream);
            }
            this.senders[track.id] = sender;
        });
    }
    addStream(stream) {
        stream.getTracks().forEach((track) => {
            this.addTrack(track, stream);
        });
    }
    replaceTrack(oldTrackID, newTrack) {
        const sender = this.senders[oldTrackID];
        if (!sender) {
            throw new Error('sender for track not found');
        }
        if (newTrack && newTrack.id !== oldTrackID) {
            delete this.senders[oldTrackID];
            this.senders[newTrack.id] = sender;
        }
        sender.replaceTrack(newTrack);
    }
    removeTrack(trackID) {
        if (!this.pc) {
            throw new Error('peer has been destroyed');
        }
        const sender = this.senders[trackID];
        if (!sender) {
            throw new Error('sender for track not found');
        }
        this.pc.removeTrack(sender);
    }
    getStats() {
        if (!this.pc) {
            throw new Error('peer has been destroyed');
        }
        return this.pc.getStats(null);
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
        clearInterval(this.pingIntervalID);
        clearTimeout(this.connTimeoutID);
    }
}
