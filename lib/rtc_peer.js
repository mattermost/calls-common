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
const rtcConnFailedErr = new Error('rtc connection failed');
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
function isFirefox() {
    return navigator.userAgent.toLowerCase().indexOf('firefox') > -1;
}
export class RTCPeer extends EventEmitter {
    constructor(config) {
        super();
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
        // We create a data channel for two reasons:
        // - Initiate a connection without preemptively adding audio/video tracks.
        // - Use this communication channel for further negotiation (to be implemented).
        this.pc.createDataChannel('calls-dc');
    }
    onICECandidate(ev) {
        if (ev.candidate) {
            this.emit('candidate', ev.candidate);
        }
    }
    onConnectionStateChange() {
        var _a;
        switch ((_a = this.pc) === null || _a === void 0 ? void 0 : _a.connectionState) {
            case 'connected':
                this.connected = true;
                break;
            case 'failed':
                this.emit('close', rtcConnFailedErr);
                break;
        }
    }
    onICEConnectionStateChange() {
        var _a;
        switch ((_a = this.pc) === null || _a === void 0 ? void 0 : _a.iceConnectionState) {
            case 'connected':
                this.emit('connect');
                break;
            case 'failed':
                this.emit('close', rtcConnFailedErr);
                break;
            case 'closed':
                this.emit('close');
                break;
            default:
        }
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
        this.emit('stream', new MediaStream([ev.track]));
    }
    signal(data) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.pc) {
                throw new Error('peer has been destroyed');
            }
            const msg = JSON.parse(data);
            if (msg.type === 'offer' && (this.makingOffer || ((_a = this.pc) === null || _a === void 0 ? void 0 : _a.signalingState) !== 'stable')) {
                this.logger.logDebug('signaling conflict, we are polite, proceeding...');
            }
            switch (msg.type) {
                case 'candidate':
                    // It's possible that ICE candidates are received moments before
                    // we set the initial remote description which would cause an
                    // error. In such case we queue them up to be added later.
                    if (this.pc.remoteDescription && this.pc.remoteDescription.type) {
                        this.pc.addIceCandidate(msg.candidate).catch((err) => {
                            this.logger.logErr('failed to add candidate', err);
                        });
                    }
                    else {
                        this.logger.logDebug('received ice candidate before remote description, queuing...');
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
                        this.logger.logDebug('adding queued ice candidate');
                        this.pc.addIceCandidate(candidate).catch((err) => {
                            this.logger.logErr('failed to add candidate', err);
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
                if (!this.config.simulcast || isFirefox()) {
                    sender = yield this.pc.addTrack(track, stream);
                    yield sender.setParameters({
                        encodings: FallbackScreenEncodings,
                    });
                }
                else {
                    const trx = this.pc.addTransceiver(track, {
                        direction: 'sendonly',
                        sendEncodings: DefaultSimulcastScreenEncodings,
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
    }
}
