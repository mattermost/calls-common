import {EventEmitter} from 'events';

import {Encoder, Decoder} from '@msgpack/msgpack';

import {Logger, RTCPeerConfig, RTCTrackOptions, DCMessageType} from './types';

import {encodeDCMsg, decodeDCMsg} from './dc_msg';

import {isFirefox, sleep} from './utils';

const rtcConnFailedErr = new Error('rtc connection failed');
const rtcConnTimeoutMsDefault = 15 * 1000;
const pingIntervalMs = 1000;
const signalingLockTimeoutMs = 5000;
export const signalingLockCheckIntervalMs = 50;

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
    private dcNegotiated = false;
    private dcLockResponseCb: ((acquired: boolean) => void) | null = null;
    private readonly senders: { [key: string]: RTCRtpSender[] };
    private readonly logger: Logger;
    private enc: Encoder;
    private dec: Decoder;
    private lockID: number;

    private pingIntervalID: ReturnType<typeof setInterval>;
    private connTimeoutID: ReturnType<typeof setTimeout>;
    private rtt = 0;
    private lastPingTS = 0;

    private makingOffer = false;
    private candidates: RTCIceCandidate[] = [];

    public connected: boolean;

    constructor(config: RTCPeerConfig) {
        super();
        this.config = config;
        this.logger = config.logger;

        // We keep a map of track IDs -> RTP sender so that we can easily
        // replace tracks when muting/unmuting.
        this.senders = {};

        this.lockID = 0;

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

    private dcHandler(ev: MessageEvent) {
        try {
            const {mt, payload} = decodeDCMsg(this.dec, ev.data);
            switch (mt) {
            case DCMessageType.Pong:
                if (this.lastPingTS > 0) {
                    this.rtt = (performance.now() - this.lastPingTS) / 1000;
                }
                break;
            case DCMessageType.SDP:
                this.logger.logDebug('RTCPeer.dcHandler: received sdp dc message');
                this.signal(payload as string).catch((err) => {
                    this.logger.logErr('RTCPeer.dcHandler: failed to signal sdp, unlocking', err);
                    return this.unlockSignalingLock();
                });
                break;
            case DCMessageType.Lock:
                this.logger.logDebug('RTCPeer.dcHandler: received lock response', payload);

                if (this.dcLockResponseCb) {
                    this.dcLockResponseCb(payload as boolean);
                } else {
                    this.logger.logWarn('RTCPeer.dcHandler: received lock response but no callback set');
                }

                break;
            default:
                this.logger.logWarn(`RTCPeer.dcHandler: unexpected dc message type ${mt}`);
            }
        } catch (err) {
            this.logger.logErr('failed to decode dc message', err);
        }
    }

    private initPingHandler() {
        return setInterval(() => {
            if (this.dc.readyState !== 'open') {
                return;
            }
            this.lastPingTS = performance.now();
            this.dc.send(encodeDCMsg(this.enc, DCMessageType.Ping));
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
            this.logger.logDebug('RTCPeer.onICECandidate: local candidate', JSON.stringify(ev.candidate));
            this.emit('candidate', ev.candidate);
        }
    }

    private onConnectionStateChange() {
        this.logger.logDebug(`RTCPeer: connection state change -> ${this.pc?.connectionState}`);
        switch (this.pc?.connectionState) {
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

    private onICEConnectionStateChange() {
        this.logger.logDebug(`RTCPeer: ICE connection state change -> ${this.pc?.iceConnectionState}`);
    }

    private enqueueLockMsg(lockID: number) {
        setTimeout(() => {
            if (this.dc.readyState === 'closed' || this.dc.readyState === 'closing') {
                // Avoid requeuing if the data channel is closed or closing. This will eventually result in a timeout.
                this.logger.logDebug(`RTCPeer.enqueueLockMsg(${lockID}): dc closed or closing, returning`);
                return;
            }

            if (!this.dcNegotiated || this.dc.readyState !== 'open') {
                this.logger.logDebug(`RTCPeer.enqueueLockMsg(${lockID}): dc not negotiated or not open, requeing`);

                this.enqueueLockMsg(lockID);
                return;
            }

            this.logger.logDebug(`RTCPeer.enqueueLockMsg(${lockID}): sending lock request`);
            this.dc.send(encodeDCMsg(this.enc, DCMessageType.Lock));
        }, signalingLockCheckIntervalMs);
    }

    private grabSignalingLock(timeoutMs: number) {
        const start = performance.now();

        const lockID = ++this.lockID;
        this.logger.logDebug(`RTCPeer.grabSignalingLock(${lockID}): beginning lock attempt`);

        return new Promise<void>((resolve, reject) => {
            // The attemptLock wrapper is needed since Promise executor should be synchronous.
            const attemptLock = async () => {
                // This covers the case of "concurrent" (interleaved in practice) attempts to lock
                // which would otherwise result in this.dcLockResponseCb getting overwritten.
                // Waiting ensures lock attempts are all done fully serially.
                while (this.dcLockResponseCb) {
                    if ((performance.now() - start) > timeoutMs) {
                        throw new Error(`(${lockID}) timed out waiting for lock`);
                    }

                    this.logger.logDebug(`RTCPeer.grabSignalingLock(${lockID}): already waiting for lock, retrying in ${signalingLockCheckIntervalMs}ms`);

                    // eslint-disable-next-line no-await-in-loop
                    await sleep(signalingLockCheckIntervalMs);
                }

                const timeoutID = setTimeout(() => {
                    this.dcLockResponseCb = null;
                    reject(new Error(`(${lockID}) timed out waiting for lock`));
                }, timeoutMs);

                this.dcLockResponseCb = (acquired) => {
                    if (acquired) {
                        this.logger.logDebug(`RTCPeer.grabSignalingLock(${lockID}): lock acquired in ${Math.round(performance.now() - start)}ms`);
                        this.dcLockResponseCb = null;
                        clearTimeout(timeoutID);
                        resolve();
                    } else {
                        this.enqueueLockMsg(lockID);
                    }
                };

                if (!this.dcNegotiated || this.dc.readyState !== 'open') {
                    this.logger.logDebug(`RTCPeer.grabSignalingLock(${lockID}): dc not negotiated or not open, requeing`);
                    this.enqueueLockMsg(lockID);
                    return;
                }

                this.logger.logDebug(`RTCPeer.grabSignalingLock(${lockID}): sending lock request`);
                this.dc.send(encodeDCMsg(this.enc, DCMessageType.Lock));
            };

            // Start the lock attempt
            attemptLock().catch((err) => reject(err));
        });
    }

    private unlockSignalingLock() {
        if (this.dcNegotiated && this.dc.readyState === 'open') {
            this.logger.logDebug('RTCPeer.unlockSignalingLock: unlocking');
            this.dc.send(encodeDCMsg(this.enc, DCMessageType.Unlock));
        } else {
            this.logger.logWarn('RTCPeer.unlockSignalingLock: dc not negotiated or not open');
        }
    }

    private async onNegotiationNeeded() {
        // Closed client case.
        if (!this.pc) {
            return;
        }

        await this.makeOffer();
    }

    private async makeOffer() {
        try {
            this.makingOffer = true;
            await this.pc?.setLocalDescription();

            this.logger.logDebug('RTCPeer.makeOffer: generated local offer', JSON.stringify(this.pc?.localDescription));

            if (this.config.dcSignaling && this.dc.readyState === 'open') {
                this.logger.logDebug('RTCPeer.makeOffer: connected, sending offer through data channel');
                try {
                    this.dc.send(encodeDCMsg(this.enc, DCMessageType.SDP, this.pc?.localDescription));
                } catch (err) {
                    this.logger.logErr('RTCPeer.makeOffer: failed to send on datachannel', err);
                }
            } else {
                if (this.config.dcSignaling) {
                    this.logger.logDebug('RTCPeer.makeOffer: dc not connected, emitting offer');
                }
                this.emit('offer', this.pc?.localDescription);
            }
        } catch (err) {
            this.emit('error', err);
            if (this.dcNegotiated && this.dc.readyState === 'open' && this.config.dcLocking) {
                this.logger.logErr('RTCPeer.makeOffer: unlocking on error');
                await this.unlockSignalingLock();
            }
        } finally {
            this.makingOffer = false;
        }
    }

    private onTrack(ev: RTCTrackEvent) {
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

    private flushICECandidates() {
        this.logger.logDebug(`RTCPeer.flushICECandidates: flushing ${this.candidates.length} candidates`);
        for (const candidate of this.candidates) {
            this.logger.logDebug('RTCPeer.flushICECandidates: adding queued ice candidate');
            this.pc?.addIceCandidate(candidate).catch((err) => {
                this.logger.logErr('RTCPeer.flushICECandidates: failed to add candidate', err);
            });
        }
        this.candidates = [];
    }

    public async signal(data: string) {
        if (!this.pc) {
            throw new Error('peer has been destroyed');
        }

        this.logger.logDebug('RTCPeer.signal: handling remote signaling data', data);

        const msg = JSON.parse(data);

        if (msg.type === 'offer' && (this.makingOffer || this.pc?.signalingState !== 'stable')) {
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
            } else {
                this.logger.logDebug('RTCPeer.signal: received ice candidate before remote description, queuing...');
                this.candidates.push(msg.candidate);
            }
            break;
        case 'offer':
            await this.pc.setRemoteDescription(msg);
            if (this.candidates.length > 0) {
                this.flushICECandidates();
            }
            await this.pc.setLocalDescription();

            this.logger.logDebug('RTCPeer.signal: generated local answer', JSON.stringify(this.pc.localDescription));

            if (this.config.dcSignaling && this.dc.readyState === 'open') {
                this.logger.logDebug('connected, sending answer through data channel', this.pc.localDescription);
                try {
                    this.dc.send(encodeDCMsg(this.enc, DCMessageType.SDP, this.pc.localDescription));
                } catch (err) {
                    this.logger.logErr('failed to send on datachannel', err);
                }
            } else {
                if (this.config.dcSignaling) {
                    this.logger.logDebug('dc not connected, emitting answer');
                }
                this.emit('answer', this.pc.localDescription);
            }

            break;
        case 'answer':
            await this.pc.setRemoteDescription(msg);
            if (this.candidates.length > 0) {
                this.flushICECandidates();
            }

            if (this.dcNegotiated) {
                if (this.dc.readyState !== 'open') {
                    this.logger.logWarn('RTCPeer.signal: dc not open upon receiving answer');
                }

                this.logger.logDebug('RTCPeer.signal: handled remote answer, unlocking');
                await this.unlockSignalingLock();
            } else {
                this.dcNegotiated = true;
            }

            break;
        default:
            throw new Error('invalid signaling data received');
        }
    }

    public async addTrack(track: MediaStreamTrack, stream: MediaStream, opts?: RTCTrackOptions) {
        if (!this.pc) {
            throw new Error('peer has been destroyed');
        }

        // TODO: remove once we can guarantee all server side (plugin and RTCD) are updated.
        if (this.config.dcLocking) {
            // We need to acquire a signaling lock before we can proceed with adding the track.
            await this.grabSignalingLock(signalingLockTimeoutMs);

            // Lock acquired, we can now proceed.
            this.logger.logDebug('RTCPeer.addTrack: signaling locked acquired');
        }

        let sender : RTCRtpSender;
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
                streams: [stream!],
            });

            if (opts?.codec && trx.setCodecPreferences) {
                this.logger.logDebug('setting video codec preference', opts.codec);
                trx.setCodecPreferences([opts.codec]);
            }

            sender = trx.sender;
        } else {
            sender = await this.pc.addTrack(track, stream);
        }

        if (!this.senders[track.id]) {
            this.senders[track.id] = [];
        }

        this.senders[track.id].push(sender);
    }

    public async addStream(stream: MediaStream, opts?: RTCTrackOptions[]) {
        for (let idx = 0; idx < stream.getTracks().length; idx++) {
            const track = stream.getTracks()[idx];

            // We actually mean to block and add them in order.
            // eslint-disable-next-line no-await-in-loop
            await this.addTrack(track, stream, opts?.[idx]);
        }
    }

    public replaceTrack(oldTrackID: string, newTrack: MediaStreamTrack | null) {
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

    public async removeTrack(trackID: string) {
        if (!this.pc) {
            throw new Error('peer has been destroyed');
        }

        // TODO: remove once we can guarantee all server side (plugin and RTCD) are updated.
        if (this.config.dcLocking) {
            // We need to acquire the signaling lock before we can proceed with removing the track.
            await this.grabSignalingLock(signalingLockTimeoutMs);

            // Lock acquired, we can now proceed.
            this.logger.logDebug('RTCPeer.removeTrack: signaling locked acquired');
        }

        const senders = this.senders[trackID];
        if (!senders) {
            throw new Error('senders for track not found');
        }

        for (const sender of senders) {
            this.pc.removeTrack(sender);
        }

        delete this.senders[trackID];
    }

    public getStats() {
        if (!this.pc) {
            throw new Error('peer has been destroyed');
        }
        return this.pc.getStats(null);
    }

    public handleMetrics(lossRate: number, jitter: number) {
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
        } catch (err) {
            this.logger.logErr('failed to send metrics through dc', err);
        }
    }

    static async getVideoCodec(mimeType: string) {
        if (RTCRtpReceiver.getCapabilities) {
            const videoCapabilities = await RTCRtpReceiver.getCapabilities('video');
            if (videoCapabilities) {
                for (const codec of videoCapabilities.codecs) {
                    if (codec.mimeType === mimeType) {
                        return codec;
                    }
                }
            }
        }
        return null;
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
        this.candidates = [];
        clearInterval(this.pingIntervalID);
        clearTimeout(this.connTimeoutID);
        this.dc.onmessage = null;
    }
}

