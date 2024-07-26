import { RTCStats, SSRCStats, ICEStats, RTCCandidatePairStats } from './types';
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
export declare function newRTCLocalOutboundStats(report: any): {
    timestamp: any;
    mid: any;
    kind: any;
    packetsSent: any;
    bytesSent: any;
    retransmittedPacketsSent: any;
    retransmittedBytesSent: any;
    nackCount: any;
    pliCount: any;
    targetBitrate: any;
};
export declare function newRTCRemoteInboundStats(report: any): {
    timestamp: any;
    kind: any;
    packetsLost: any;
    fractionLost: any;
    jitter: any;
    roundTripTime: any;
};
export declare function newRTCCandidatePairStats(report: any, reports: RTCStatsReport): RTCCandidatePairStats;
export declare function parseSSRCStats(reports: RTCStatsReport): SSRCStats;
export declare function parseICEStats(reports: RTCStatsReport): ICEStats;
export declare function parseRTCStats(reports: RTCStatsReport): RTCStats;
