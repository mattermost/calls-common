export enum DCMessageType {
    Ping = 1,
    Pong,
    SDP,
    LossRate,
    RoundTripTime,
    Jitter,
}

export type DCMessageSDP = Uint8Array;
export type DCMessageLossRate = number;
export type DCMessageRoundTripTime = number;
export type DCMessageJitter = number;
