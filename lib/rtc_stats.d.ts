import { RTCStats } from './types';
export declare function newRTCLocalInboundStats(report: any): {
    timestamp: any;
    mid: any;
    kind: any;
    trackIdentifier: any;
    packetsReceived: any;
    packetsLost: any;
    packetsDiscarded: any;
    bytesReceived: any;
    nackCount: any;
    pliCount: any;
    jitter: any;
    jitterBufferDelay: any;
};
export declare function newRTCRemoteInboundStats(report: any): {
    timestamp: any;
    kind: any;
    packetsLost: any;
    fractionLost: any;
    jitter: any;
    roundTripTime: any;
};
export declare function newRTCCandidatePairStats(report: any): {
    timestamp: any;
    priority: any;
    packetsSent: any;
    packetsReceived: any;
    currentRoundTripTime: any;
    totalRoundTripTime: any;
};
export declare function parseRTCStats(reports: RTCStatsReport): RTCStats;
