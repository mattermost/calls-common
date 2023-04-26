import {EventEmitter} from 'events';

import {Logger, RTCPeerConfig, WebRTC} from './types';

import {isFirefox, getFirefoxVersion} from './utils';

const rtcConnFailedErr = new Error('rtc connection failed');
const pingIntervalMs = 1000;

enum SimulcastLevel {
    High = 'h',
    Medium = 'm',
    Low = 'l',
}

const DefaultSimulcastScreenEncodings = [
    {rid: SimulcastLevel.Low, maxBitrate: 500 * 1000, maxFramerate: 5, scaleResolutionDownBy: 1.0} as RTCRtpEncodingParameters,
    {rid: SimulcastLevel.High, maxBitrate: 2500 * 1000, maxFramerate: 20, scaleResolutionDownBy: 1.0} as RTCRtpEncodingParameters,
];
const FallbackScreenEncodings = [
    {maxBitrate: 1000 * 1000, maxFramerate: 10, scaleResolutionDownBy: 1.0} as RTCRtpEncodingParameters,
];

export class RTCPeer extends EventEmitter {
    private config: RTCPeerConfig;
    private pc: RTCPeerConnection | null;
    private dc: RTCDataChannel;
    private readonly senders: { [key: string]: RTCRtpSender };
    private readonly logger: Logger;
    private readonly webrtc: WebRTC;

    private pingIntervalID: ReturnType<typeof setInterval>;
    private rtt = 0;

    private makingOffer = false;
    private candidates: RTCIceCandidate[] = [];

    public connected: boolean;

    constructor(config: RTCPeerConfig) {
        super();
        this.config = config;
        this.logger = config.logger;

        // use the provided webrtc methods (for mobile), or the build in lib.dom methods (for webapp)
        if (config.webrtc) {
            this.webrtc = config.webrtc;
        } else {
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
        // - Calculate transport latency through simple ping/pong sequences.
        // - Use this communication channel for further negotiation (to be implemented).
        this.dc = this.pc.createDataChannel('calls-dc');

        this.pingIntervalID = this.initPingHandler();
    }

    private initPingHandler() {
        let pingTS = 0;
        this.dc.onmessage = ({data}) => {
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

    public getRTT() {
        if (!this.pc) {
            throw new Error('peer has been destroyed');
        }
        return this.rtt;
    }

    private onICECandidate(ev: RTCPeerConnectionIceEvent) {
        if (ev.candidate) {
            this.emit('candidate', ev.candidate);
        }
    }

    private onConnectionStateChange() {
        switch (this.pc?.connectionState) {
        case 'connected':
            this.connected = true;
            break;
        case 'failed':
            this.emit('close', rtcConnFailedErr);
            break;
        }
    }

    private onICEConnectionStateChange() {
        switch (this.pc?.iceConnectionState) {
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

    private async onNegotiationNeeded() {
        try {
            this.makingOffer = true;
            await this.pc?.setLocalDescription();
            this.emit('offer', this.pc?.localDescription);
        } catch (err) {
            this.emit('error', err);
        } finally {
            this.makingOffer = false;
        }
    }

    private onTrack(ev: RTCTrackEvent) {
        if (this.pc) {
            // If we are trying to reuse an existing transceiver to receive
            // the track we may need to activate it back.
            for (const t of this.pc.getTransceivers()) {
                if (t.receiver && t.receiver.track === ev.track) {
                    if (t.direction === 'inactive') {
                        this.logger.logDebug('reactivating transceiver for track');
                        t.direction = 'recvonly';
                    }
                    break;
                }
            }
        }

        this.emit('stream', new this.webrtc.MediaStream([ev.track]));
    }

    public async signal(data: string) {
        if (!this.pc) {
            throw new Error('peer has been destroyed');
        }

        const msg = JSON.parse(data);

        if (msg.type === 'offer' && (this.makingOffer || this.pc?.signalingState !== 'stable')) {
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
            } else {
                this.logger.logDebug('received ice candidate before remote description, queuing...');
                this.candidates.push(msg.candidate);
            }
            break;
        case 'offer':
            await this.pc.setRemoteDescription(msg);
            await this.pc.setLocalDescription();
            this.emit('answer', this.pc.localDescription);
            break;
        case 'answer':
            await this.pc.setRemoteDescription(msg);
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
    }

    public async addTrack(track: MediaStreamTrack, stream: MediaStream) {
        if (!this.pc) {
            throw new Error('peer has been destroyed');
        }

        let sender : RTCRtpSender;
        if (track.kind === 'video') {
            // Simulcast

            // NOTE: Unfortunately Firefox cannot simulcast screen sharing tracks
            // properly (https://bugzilla.mozilla.org/show_bug.cgi?id=1692873).
            // TODO: check whether track is coming from screenshare when we
            // start supporting video.

            if (isFirefox() && getFirefoxVersion() < 110) {
                // DEPRECATED: we should consider removing this as sendEncodings
                // has been supported since v110.
                sender = await this.pc.addTrack(track, stream!);
                const params = await sender.getParameters();
                params.encodings = FallbackScreenEncodings;
                await sender.setParameters(params);

                // We need to explicitly set the transceiver direction or Firefox
                // will default to sendrecv which will cause problems when removing the track.
                for (const trx of this.pc.getTransceivers()) {
                    if (trx.sender === sender) {
                        this.logger.logDebug('setting transceiver direction to sendonly');
                        trx.direction = 'sendonly';
                        break;
                    }
                }
            } else {
                const trx = this.pc.addTransceiver(track, {
                    direction: 'sendonly',
                    sendEncodings: this.config.simulcast && !isFirefox() ? DefaultSimulcastScreenEncodings : FallbackScreenEncodings,
                    streams: [stream!],
                });
                sender = trx.sender;
            }
        } else {
            sender = await this.pc.addTrack(track, stream);
        }

        this.senders[track.id] = sender;
    }

    public addStream(stream: MediaStream) {
        stream.getTracks().forEach((track) => {
            this.addTrack(track, stream);
        });
    }

    public replaceTrack(oldTrackID: string, newTrack: MediaStreamTrack | null) {
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

    public removeTrack(trackID: string) {
        if (!this.pc) {
            throw new Error('peer has been destroyed');
        }

        const sender = this.senders[trackID];
        if (!sender) {
            throw new Error('sender for track not found');
        }

        this.pc.removeTrack(sender);
    }

    public getStats() {
        if (!this.pc) {
            throw new Error('peer has been destroyed');
        }
        return this.pc.getStats(null);
    }

    public destroy() {
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
    }
}

