export enum DCMessageType {
    Ping = 1,
    Pong,
    SDP,
}

export type DCMessageSDP = Uint8Array;
