export declare enum DCMessageType {
    Ping = 1,
    Pong = 2,
    SDP = 3,
    LossRate = 4,
    RoundTripTime = 5,
    Jitter = 6
}
export type DCMessageSDP = Uint8Array;
export type DCMessageLossRate = number;
export type DCMessageRoundTripTime = number;
export type DCMessageJitter = number;
