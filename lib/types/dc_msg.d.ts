export declare enum DCMessageType {
    Ping = 1,
    Pong = 2,
    SDP = 3,
    LossRate = 4,
    RoundTripTime = 5,
    Jitter = 6,
    Lock = 7,
    Unlock = 8,
    MediaMap = 9,
    CodecSupportMap = 10
}
export type DCMessageSDP = Uint8Array;
export type DCMessageLossRate = number;
export type DCMessageRoundTripTime = number;
export type DCMessageJitter = number;
export type TrackInfo = {
    type: string;
    sender_id: string;
};
export type DCMessageMediaMap = {
    [key: string]: TrackInfo;
};
export declare enum CodecSupportLevel {
    None = 0,
    Partial = 1,
    Full = 2
}
export declare enum CodecMimeType {
    AV1 = "video/AV1"
}
export type DCMessageCodecSupportMap = {
    [key in CodecMimeType]: CodecSupportLevel;
};
export declare const DCMessageCodecSupportMapDefault: {
    "video/AV1": CodecSupportLevel;
};
