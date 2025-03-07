export enum DCMessageType {
    Ping = 1,
    Pong,
    SDP,
    LossRate,
    RoundTripTime,
    Jitter,
    Lock,
    Unlock,
}

export type DCMessageSDP = Uint8Array;
export type DCMessageLossRate = number;
export type DCMessageRoundTripTime = number;
export type DCMessageJitter = number;
export type DCMessageLock = boolean;
