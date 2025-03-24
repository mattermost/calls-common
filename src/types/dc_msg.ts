export enum DCMessageType {
    Ping = 1,
    Pong,
    SDP,
    LossRate,
    RoundTripTime,
    Jitter,
    Lock,
    Unlock,
    MediaMap,
}

export type DCMessageSDP = Uint8Array;
export type DCMessageLossRate = number;
export type DCMessageRoundTripTime = number;
export type DCMessageJitter = number;
export type TrackInfo = {
    type: string;
    sender_id: string;
}
export type DCMessageMediaMap = {[key: string]: TrackInfo};

