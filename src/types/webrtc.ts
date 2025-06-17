import {RTCPeer} from '../rtc_peer';

import {Logger} from './types';

export type RTCPeerConfig = {
    iceServers: RTCIceServer[];
    logger: Logger;
    dcSignaling: boolean;
    dcLocking: boolean;
    simulcast?: boolean;
    connTimeoutMs?: number;
}

export type SSRCStats = {
    [key: number]: {
        local: RTCLocalStats;
        remote: RTCRemoteStats;
    }
}

export type ICEStats = {
    [key: string]: RTCCandidatePairStats[];
}

export type RTCStats = {
    ssrcStats: SSRCStats;
    iceStats: ICEStats;
};

export type RTCLocalStats = {
    in?: RTCLocalInboundStats;
    out?: RTCLocalOutboundStats;
}

export type RTCRemoteStats = {
    in?: RTCRemoteInboundStats;
    out?: RTCRemoteOutboundStats;
}

export type RTCLocalInboundStats = {
    timestamp: number;
    kind: string;
    packetsReceived: number;
    bytesReceived: number;
    packetsLost: number;
    packetsDiscarded: number;
    jitter: number;
    jitterBufferDelay: number;
}

export type RTCLocalOutboundStats = {
    timestamp: number;
    kind: string;
    packetsSent: number;
    bytesSent: number;
    retransmittedPacketsSent: number;
    retransmittedBytesSent: number;
    nackCount: number;
    targetBitrate: number;
}

export type RTCRemoteInboundStats = {
    timestamp: number;
    kind: string;
    packetsLost: number;
    fractionLost: number;
    jitter: number;
    roundTripTime: number;
}

export type RTCRemoteOutboundStats = {
    timestamp: number;
    kind: string;
    packetsSent: number;
    bytesSent: number;
}

// This should be in lib.dom.d.ts
export type RTCIceCandidateStats = {
    candidateType: string;
    protocol: string;
    port: number;
}

export type RTCCandidatePairStats = {
    id: string;
    timestamp: number;
    priority?: number;
    packetsSent: number;
    packetsReceived: number;
    currentRoundTripTime: number;
    totalRoundTripTime: number;
    nominated?: boolean;
    state: RTCStatsIceCandidatePairState;
    local?: RTCIceCandidateStats;
    remote?: RTCIceCandidateStats;
}

export type RTCMonitorConfig = {
    peer: RTCPeer;
    logger: Logger;
    monitorInterval: number;
}

export type RTPEncodingParameters = {
    rid?: string;
    maxBitrate: number;
    maxFramerate: number;
    scaleResolutionDownBy: number;
}

export type RTCTrackOptions = {
    codec?: RTCRtpCodecCapability;
    encodings?: RTPEncodingParameters[];
}
