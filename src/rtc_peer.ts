import {EventEmitter} from 'events';

import {Encoder, Decoder} from '@msgpack/msgpack';

import {
    Logger,
    RTCPeerConfig,
    RTCTrackOptions,
    DCMessageType,
    DCMessageMediaMap,
    DCMessageCodecSupportMap,
    DCMessageCodecSupportMapDefault,
    CodecSupportLevel,
    CodecMimeType,
} from './types';

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

type TrackContext = {
    track: MediaStreamTrack;
    stream: MediaStream;
    sender: RTCRtpSender;
    opts?: RTCTrackOptions;
}

export class RTCPeer extends EventEmitter {
    private config: RTCPeerConfig;
    private pc: RTCPeerConnection | null;
    private dc: RTCDataChannel;
    private dcNegotiated = false;
    private dcLockResponseCb: ((acquired: boolean) => void) | null = null;
    private readonly trackCtxs: { [key: string]: TrackContext };
    private readonly logger: Logger;
    private enc: Encoder;
    private dec: Decoder;

    private pingIntervalID: ReturnType<typeof setInterval>;
    private connTimeoutID: ReturnType<typeof setTimeout>;
    private rtt = 0;
    private lastPingTS = 0;

    private makingOffer = false;
    private candidates: RTCIceCandidate[] = [];

    public connected: boolean;

    private mediaMap: DCMessageMediaMap = {};

    public codecSupportMap: DCMessageCodecSupportMap = DCMessageCodecSupportMapDefault;

    constructor(config: RTCPeerConfig) {
        super();
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
                this.dcLockResponseCb?.(payload as boolean);
                break;
            case DCMessageType.MediaMap:
                this.logger.logDebug('RTCPeer.dcHandler: received media map dc message', payload);
                this.mediaMap = payload as DCMessageMediaMap;
                break;
            case DCMessageType.CodecSupportMap:
                this.logger.logDebug('RTCPeer.dcHandler: received codec support map dc message', payload);
                this.codecSupportMap = payload as DCMessageCodecSupportMap;

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
        } catch (err) {
            this.logger.logErr('failed to decode dc message', err);
        }
    }

    private async switchCodecForTrack(tctx: TrackContext, targetCodec: RTCRtpCodecCapability) {
        // First, we stop sending the track with the current codec.
        // This is to ensure we are only sending one encoding at any given time.
        // Replacing the track this way also allows us to quickly start sending again
        // if support changes during the call (e.g. the only unsupported client leaves).
        await tctx.sender.replaceTrack(null);

        // Check if we already have a sender with the target codec that can be reused. This avoids having to add a new track (and transceiver)
        // every time we need to switch codecs. Once we switched once we should have both VP8 and AV1 senders available.
        const existingSender = this.pc?.getSenders().find((s) => {
            const params = s.getParameters();

            return s.track === null && params.codecs?.length > 0 && params.codecs[0].mimeType === targetCodec.mimeType;
        });

        if (existingSender) {
            this.logger.logDebug(`RTCPeer.switchCodecForTrack: ${targetCodec.mimeType} sender already exists, replacing track`, existingSender, tctx);
            await existingSender.replaceTrack(tctx.track);
            this.trackCtxs[tctx.track.id] = {
                ...tctx,
                sender: existingSender,
            };
        } else {
            // Prepare options with the target codec
            const opts = {
                ...tctx.opts,

                // It's important we force the codec here, otherwise the server side may just answer
                // saying it's okay what we are sending already :)
                codecs: [targetCodec],
            };

            this.logger.logDebug(`RTCPeer.switchCodecForTrack: ${targetCodec.mimeType} sender does not exist, adding new track`, opts, tctx);

            // We are under signaling lock here, so must call the non-locked method for adding a new track.
            await this.addTrackNoLock(tctx.track, tctx.stream, opts);
        }
    }

    // handleCodecSupportUpdate is called when the codec support map is received from the server.
    // It returns a boolean indicating whether renegotiation is needed, in which case we shouldn't
    // unlock the signaling lock.
    private async handleCodecSupportUpdate(supportMap: DCMessageCodecSupportMap) {
        // We'll keep this simple as we only need to handle VP8<->AV1 transitions for the time being.
        // A more generic solution can be implemented later if needed.

        // First we to check whether the client can send AV1, otherwise there's no point continuing.
        const av1Codec = await RTCPeer.getVideoCodec(CodecMimeType.AV1);
        if (!av1Codec) {
            this.logger.logDebug('RTCPeer.handleCodecSupportUpdate: client does not support AV1 codec, returning');
            return false;
        }

        const vp8Codec = await RTCPeer.getVideoCodec(CodecMimeType.VP8);
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
            if (tctx.sender.track?.kind !== 'video') {
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
                await this.switchCodecForTrack(tctx, targetCodec);

                needsNegotiation = true;
            }
        }

        const existingTransceiver = this.pc?.getTransceivers().find((trx) => {
            if (!trx.receiver) {
                return false;
            }
            return trx.receiver.track && this.mediaMap[trx.mid!]?.mime_type === targetCodec.mimeType;
        });

        if (existingTransceiver) {
            this.logger.logDebug(`RTCPeer.handleCodecSupportUpdate: ${targetCodec.mimeType} receiver already exists, need to emit track`, existingTransceiver, existingTransceiver.receiver.track);
            this.emit('stream', new MediaStream([existingTransceiver.receiver.track]), this.mediaMap[existingTransceiver.mid!]);
        }

        if (needsNegotiation) {
            await this.onNegotiationNeeded();
        }

        return needsNegotiation;
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

    private enqueueLockMsg() {
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

    private grabSignalingLock(timeoutMs: number) {
        const start = performance.now();

        return new Promise<void>((resolve, reject) => {
            // The attemptLock wrapper is needed since Promise executor should be synchronous.
            const attemptLock = async () => {
                // This covers the case of "concurrent" (interleaved in practice) attempts to lock
                // which would otherwise result in this.dcLockResponseCb getting overwritten.
                // Waiting ensures lock attempts are all done fully serially.
                while (this.dcLockResponseCb) {
                    if ((performance.now() - start) > timeoutMs) {
                        throw new Error('timed out waiting for lock');
                    }

                    this.logger.logDebug(`RTCPeer.grabSignalingLock: already waiting for lock, retrying in ${signalingLockCheckIntervalMs}ms`);

                    // eslint-disable-next-line no-await-in-loop
                    await sleep(signalingLockCheckIntervalMs);
                }

                this.dcLockResponseCb = (acquired) => {
                    if (acquired) {
                        this.logger.logDebug(`RTCPeer.grabSignalingLock: lock acquired in ${Math.round(performance.now() - start)}ms`);
                        this.dcLockResponseCb = null;
                        resolve();
                    } else {
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
            };

            // Start the lock attempt
            attemptLock().catch((err) => reject(err));
        });
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

            this.logger.logErr('RTCPeer.makeOffer: failed to create offer, unlocking', err);
            this.unlockSignalingLock();
        } finally {
            this.makingOffer = false;
        }
    }

    private unlockSignalingLock() {
        if (this.dcNegotiated && this.dc.readyState === 'open') {
            this.logger.logDebug('RTCPeer.unlockSignalingLock: unlocking');
            this.dc.send(encodeDCMsg(this.enc, DCMessageType.Unlock));
        } else {
            this.logger.logWarn('RTCPeer.unlockSignalingLock: dc not negotiated or not open');
        }
    }

    private onTrack(ev: RTCTrackEvent) {
        this.emit('stream', new MediaStream([ev.track]), this.mediaMap[ev.transceiver.mid!]);
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

    private async addTrackNoLock(track: MediaStreamTrack, stream: MediaStream, opts?: RTCTrackOptions) {
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

            let sendEncodings = this.config.simulcast && !isFirefox() ? DefaultSimulcastScreenEncodings : FallbackScreenEncodings;
            if (opts?.encodings) {
                sendEncodings = opts.encodings as RTCRtpEncodingParameters[];
            }

            this.logger.logDebug('RTCPeer.addTrack: creating new transceiver on send');
            const trx = this.pc.addTransceiver(track, {
                direction: 'sendrecv',
                sendEncodings,
                streams: [stream!],
            });

            if (trx.setCodecPreferences) {
                const vp8Codec = await RTCPeer.getVideoCodec(CodecMimeType.VP8);
                if (!vp8Codec) {
                    throw new Error('VP8 codec not found');
                }

                const codecs = [vp8Codec];
                const av1Codec = await RTCPeer.getVideoCodec(CodecMimeType.AV1);
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
        } else {
            // TODO: MM-63811, use transceiver API
            sender = await this.pc.addTrack(track, stream);
        }

        this.trackCtxs[track.id] = {
            sender,
            stream,
            opts,
            track,
        };
    }

    public async addTrack(track: MediaStreamTrack, stream: MediaStream, opts?: RTCTrackOptions) {
        if (!this.pc) {
            throw new Error('peer has been destroyed');
        }

        this.logger.logDebug('RTCPeer.addTrack: grabbing signaling lock');

        // We need to acquire a signaling lock before we can proceed with adding the track.
        await this.grabSignalingLock(signalingLockTimeoutMs);

        // Lock acquired, we can now proceed.
        this.logger.logDebug('RTCPeer.addTrack: signaling locked acquired');

        await this.addTrackNoLock(track, stream, opts);

        await this.onNegotiationNeeded();
    }

    public async addStream(stream: MediaStream, opts?: RTCTrackOptions[]) {
        for (let idx = 0; idx < stream.getTracks().length; idx++) {
            const track = stream.getTracks()[idx];

            // We actually mean to block and add them in order.
            // eslint-disable-next-line no-await-in-loop
            await this.addTrack(track, stream, opts?.[idx]);
        }
    }

    public async replaceTrack(oldTrackID: string, newTrack: MediaStreamTrack | null) {
        if (!this.pc) {
            throw new Error('peer has been destroyed');
        }

        // Since we expect replaceTrack not to cause a re-negotiation, locking is not required.
        const ctx = this.trackCtxs[oldTrackID];
        if (!ctx) {
            throw new Error('ctx for track not found');
        }

        if (newTrack && newTrack.id !== oldTrackID) {
            this.trackCtxs[newTrack.id] = {
                ...this.trackCtxs[oldTrackID],
                track: newTrack,
            };
            delete this.trackCtxs[oldTrackID];
        }

        await ctx.sender.replaceTrack(newTrack);
    }

    public async removeTrack(trackID: string) {
        if (!this.pc) {
            throw new Error('peer has been destroyed');
        }

        this.logger.logDebug('RTCPeer.removeTrack: grabbing signaling lock');

        // We need to acquire the signaling lock before we can proceed with removing the track.
        await this.grabSignalingLock(signalingLockTimeoutMs);

        // Lock acquired, we can now proceed.
        this.logger.logDebug('RTCPeer.removeTrack: signaling locked acquired');

        const ctx = this.trackCtxs[trackID];
        if (!ctx) {
            throw new Error('ctx for track not found');
        }

        // TODO: MM-63811, use transceiver API
        await this.pc.removeTrack(ctx.sender);

        delete this.trackCtxs[trackID];

        await this.onNegotiationNeeded();
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

