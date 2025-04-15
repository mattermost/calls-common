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
    CodecSupportMap,
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

export enum CodecSupportLevel {
    None = 0,
    Partial = 1,
    Full = 2,
}
export enum CodecMimeType {
    AV1 = 'video/AV1',
}
export type DCMessageCodecSupportMap = {[key in CodecMimeType]: CodecSupportLevel}
export const DCMessageCodecSupportMapDefault = {
    [CodecMimeType.AV1]: CodecSupportLevel.None,
};
