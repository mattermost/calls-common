import { RTCPeer } from '../rtc_peer';
import { Logger } from './types';
export interface WebRTC {
    MediaStream: typeof MediaStream;
    RTCPeerConnection: typeof RTCPeerConnection;
}
export type RTCPeerConfig = {
    iceServers: RTCIceServer[];
    logger: Logger;
    webrtc?: WebRTC;
    simulcast?: boolean;
    connTimeoutMs: number;
};
export type RTCStats = {
    [key: number]: {
        local: RTCLocalStats;
        remote: RTCRemoteStats;
    };
};
export type RTCLocalStats = {
    in?: RTCLocalInboundStats;
    out?: RTCLocalOutboundStats;
};
export type RTCRemoteStats = {
    in?: RTCRemoteInboundStats;
    out?: RTCRemoteOutboundStats;
};
export type RTCLocalInboundStats = {
    timestamp: number;
    kind: string;
    packetsReceived: number;
    bytesReceived: number;
    packetsLost: number;
    packetsDiscarded: number;
    jitter: number;
    jitterBufferDelay: number;
};
export type RTCLocalOutboundStats = {
    timestamp: number;
    kind: string;
    packetsSent: number;
    bytesSent: number;
    retransmittedPacketsSent: number;
    retransmittedBytesSent: number;
    nackCount: number;
    targetBitrate: number;
};
export type RTCRemoteInboundStats = {
    timestamp: number;
    kind: string;
    packetsLost: number;
    fractionLost: number;
    jitter: number;
    roundTripTime: number;
};
export type RTCRemoteOutboundStats = {
    timestamp: number;
    kind: string;
    packetsSent: number;
    bytesSent: number;
};
export type RTCCandidatePairStats = {
    timestamp: number;
    priority?: number;
    packetsSent: number;
    packetsReceived: number;
    currentRoundTripTime: number;
    totalRoundTripTime: number;
};
export type RTCMonitorConfig = {
    peer: RTCPeer;
    logger: Logger;
    monitorInterval: number;
};
