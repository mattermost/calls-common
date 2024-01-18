/// <reference types="node" />
import { EventEmitter } from 'events';
import { RTCPeerConfig, RTCTrackOptions } from './types';
export declare class RTCPeer extends EventEmitter {
    private config;
    private pc;
    private dc;
    private readonly senders;
    private readonly logger;
    private readonly webrtc;
    private pingIntervalID;
    private connTimeoutID;
    private rtt;
    private makingOffer;
    private candidates;
    connected: boolean;
    constructor(config: RTCPeerConfig);
    private initPingHandler;
    getRTT(): number;
    private onICECandidate;
    private onConnectionStateChange;
    private onICEConnectionStateChange;
    private onNegotiationNeeded;
    private onTrack;
    signal(data: string): Promise<void>;
    addTrack(track: MediaStreamTrack, stream: MediaStream, opts?: RTCTrackOptions): Promise<void>;
    addStream(stream: MediaStream, opts?: RTCTrackOptions[]): void;
    replaceTrack(oldTrackID: string, newTrack: MediaStreamTrack | null): void;
    removeTrack(trackID: string): void;
    getStats(): Promise<RTCStatsReport>;
    destroy(): void;
}
