import { EventEmitter } from 'events';
import { RTCPeerConfig, RTCTrackOptions } from './types';
export declare const signalingLockCheckIntervalMs = 50;
export declare class RTCPeer extends EventEmitter {
    private config;
    private pc;
    private dc;
    private dcNegotiated;
    private dcLockResponseCb;
    private readonly senders;
    private readonly logger;
    private enc;
    private dec;
    private pingIntervalID;
    private connTimeoutID;
    private rtt;
    private lastPingTS;
    private makingOffer;
    private candidates;
    connected: boolean;
    constructor(config: RTCPeerConfig);
    private dcHandler;
    private initPingHandler;
    getRTT(): number;
    private onICECandidate;
    private onConnectionStateChange;
    private onICEConnectionStateChange;
    private enqueueLockMsg;
    private grabSignalingLock;
    private onNegotiationNeeded;
    private makeOffer;
    private onTrack;
    private flushICECandidates;
    signal(data: string): Promise<void>;
    addTrack(track: MediaStreamTrack, stream: MediaStream, opts?: RTCTrackOptions): Promise<void>;
    addStream(stream: MediaStream, opts?: RTCTrackOptions[]): Promise<void>;
    replaceTrack(oldTrackID: string, newTrack: MediaStreamTrack | null): void;
    removeTrack(trackID: string): Promise<void>;
    getStats(): Promise<RTCStatsReport>;
    handleMetrics(lossRate: number, jitter: number): void;
    static getVideoCodec(mimeType: string): Promise<RTCRtpCodec | null>;
    destroy(): void;
}
