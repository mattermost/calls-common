export type EmptyData = Record<string, never>;
export type BaseData = {
    channelID?: string;
};
export type HelloData = {
    connection_id: string;
    server_version: string;
} & BaseData;
export type CallStartData = {
    channelID: string;
    start_at: number;
    thread_id: string;
    owner_id: string;
    host_id: string;
} & BaseData;
export type UserDisconnectedData = {
    userID: string;
} & BaseData;
export type UserConnectedData = {
    userID: string;
} & BaseData;
export type UserMutedUnmutedData = {
    userID: string;
} & BaseData;
export type UserVoiceOnOffData = {
    userID: string;
} & BaseData;
export type UserScreenOnOffData = {
    userID: string;
} & BaseData;
export type UserRaiseUnraiseHandData = {
    userID: string;
    raised_hand: number;
} & BaseData;
export type EmojiData = {
    name: string;
    unified: string;
    skin?: string;
    literal?: string;
} & BaseData;
export type UserReactionData = {
    user_id: string;
    emoji: EmojiData;
    timestamp: number;
} & BaseData;
export type CallHostChangedData = {
    hostID: string;
} & BaseData;
export type CallRecordingState = {
    init_at: number;
    start_at: number;
    end_at: number;
    err?: string;
    error_at?: number;
} & BaseData;
export type CallRecordingStateData = {
    recState: CallRecordingState;
    callID: string;
} & BaseData;
export type UserState = {
    channelID?: string;
    id: string;
    voice?: boolean;
    unmuted: boolean;
    raised_hand: number;
    reaction?: Reaction;
} & BaseData;
export type WebsocketEventData = EmptyData | HelloData | CallStartData | UserDisconnectedData | UserConnectedData | UserMutedUnmutedData | UserVoiceOnOffData | UserScreenOnOffData | UserRaiseUnraiseHandData | EmojiData | UserReactionData | CallHostChangedData | CallRecordingStateData | UserState;
export interface Logger {
    logDebug: (...args: unknown[]) => void;
    logErr: (...args: unknown[]) => void;
    logWarn: (...args: unknown[]) => void;
    logInfo: (...args: unknown[]) => void;
}
export type CallsConfig = {
    ICEServers: string[];
    ICEServersConfigs: RTCIceServer[];
    DefaultEnabled: boolean;
    MaxCallParticipants: number;
    NeedsTURNCredentials: boolean;
    AllowScreenSharing: boolean;
    EnableRecordings: boolean;
    MaxRecordingDuration: number;
    sku_short_name: string;
    EnableSimulcast: boolean;
};
export type Reaction = UserReactionData & {
    displayName: string;
};
export type CallUserState = {
    unmuted: boolean;
    raised_hand: number;
};
export type CallState = {
    id: string;
    start_at: number;
    users: string[];
    states?: CallUserState[];
    thread_id: string;
    post_id: string;
    screen_sharing_id: string;
    owner_id: string;
    host_id: string;
    recording?: CallRecordingState;
};
export type CallChannelState = {
    enabled: boolean;
    channel_id: string;
    call: CallState;
};
