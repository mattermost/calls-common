export type EmptyData = Record<string, never>;
export type BaseData = {
    channelID?: string;
};
export type HelloData = {
    connection_id: string;
    server_version: string;
} & BaseData;
export type CallStartData = {
    id: string;
    channelID: string;
    start_at: number;
    thread_id: string;
    post_id: string;
    owner_id: string;
    host_id: string;
} & BaseData;
export type UserDisconnectedData = {
    userID: string;
} & BaseData;
export type UserConnectedData = {
    userID: string;
} & BaseData;
export type UserJoinedData = {
    user_id: string;
    session_id: string;
} & BaseData;
export type UserLeftData = {
    user_id: string;
    session_id: string;
} & BaseData;
export type UserMutedUnmutedData = {
    userID: string;
    session_id: string;
} & BaseData;
export type UserVoiceOnOffData = {
    userID: string;
    session_id: string;
} & BaseData;
export type UserScreenOnOffData = {
    userID: string;
    session_id: string;
} & BaseData;
export type UserRaiseUnraiseHandData = {
    userID: string;
    session_id: string;
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
    session_id: string;
    emoji: EmojiData;
    timestamp: number;
} & BaseData;
export type CallHostChangedData = {
    hostID: string;
    call_id: string;
} & BaseData;
export type CallJobState = {
    type: string;
    init_at: number;
    start_at: number;
    end_at: number;
    err?: string;
    error_at?: number;
} & BaseData;
export type CallJobStateData = {
    jobState: CallJobState;
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
export type UserDismissedNotification = {
    userID: string;
    callID: string;
};
export type UserRemovedData = {
    user_id?: string;
    channel_id?: string;
    remover_id: string;
} & BaseData;
export type LiveCaptionData = {
    channel_id: string;
    user_id: string;
    session_id: string;
    text: string;
} & BaseData;
export type WebsocketEventData = EmptyData | HelloData | CallStartData | UserDisconnectedData | UserConnectedData | UserMutedUnmutedData | UserVoiceOnOffData | UserScreenOnOffData | UserRaiseUnraiseHandData | EmojiData | UserReactionData | CallHostChangedData | CallJobStateData | UserState | UserDismissedNotification | CallStateData | JobStopData | UserRemovedData | LiveCaptionData | HostControlMsg | HostControlRemoved | HostControlLowerHand;
export interface Logger {
    logDebug: (...args: unknown[]) => void;
    logErr: (...args: unknown[]) => void;
    logWarn: (...args: unknown[]) => void;
    logInfo: (...args: unknown[]) => void;
}
export declare enum TranscribeAPI {
    WhisperCPP = "whisper.cpp",
    AzureAI = "azure"
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
    EnableRinging: boolean;
    EnableTranscriptions: boolean;
    EnableLiveCaptions: boolean;
    HostControlsAllowed: boolean;
    EnableAV1: boolean;
    GroupCallsAllowed: boolean;
    EnableDCSignaling: boolean;
    TranscribeAPI: TranscribeAPI;
    ICEHostOverride?: string;
    ICEHostPortOverride?: number | null;
    UDPServerAddress?: string;
    TCPServerAddress?: string;
    UDPServerPort?: number;
    TCPServerPort?: number;
    RTCDServiceURL?: string;
    TURNStaticAuthSecret?: string;
    TURNCredentialsExpirationMinutes?: number;
    ServerSideTURN?: boolean;
    JobServiceURL?: string;
    RecordingQuality?: string;
    EnableIPv6?: boolean;
    TranscriberModelSize?: string;
    TranscribeAPIAzureSpeechKey?: string;
    TranscribeAPIAzureSpeechRegion?: string;
    TranscriberNumThreads?: number;
    LiveCaptionsModelSize?: string;
    LiveCaptionsNumTranscribers?: number;
    LiveCaptionsNumThreadsPerTranscriber?: number;
    LiveCaptionsLanguage?: string;
};
export type Reaction = UserReactionData & {
    displayName: string;
};
export type LiveCaption = LiveCaptionData & {
    display_name: string;
    caption_id: string;
};
export type SessionState = {
    session_id: string;
    user_id: string;
    unmuted: boolean;
    raised_hand: number;
};
export type UserSessionState = SessionState & {
    voice?: boolean;
    reaction?: Reaction;
};
export type CallState = {
    id: string;
    start_at: number;
    sessions: SessionState[];
    thread_id: string;
    post_id: string;
    screen_sharing_session_id: string;
    owner_id: string;
    host_id: string;
    recording?: CallJobState;
    live_captions?: CallJobState;
    dismissed_notification?: {
        [userID: string]: boolean;
    };
};
export type CallStateData = {
    channel_id: string;
    call: string;
};
export type CallChannelState = {
    enabled: boolean;
    channel_id: string;
    call: CallState;
};
export type ColorRGB = {
    r: number;
    g: number;
    b: number;
};
export type ColorHSL = {
    h: number;
    s: number;
    l: number;
};
export type Caption = {
    title: string;
    language: string;
    file_id: string;
};
export declare function isCaption(obj: unknown): obj is Caption;
export type JobStopData = {
    job_id: string;
};
export type CallJobMetadata = {
    file_id: string;
    post_id: string;
    tr_id?: string;
    rec_id?: string;
};
export declare function isCallJobMetadata(obj: unknown): obj is CallJobMetadata;
export type CallRecordingPropsMap = {
    [key: string]: CallJobMetadata;
};
export type CallTranscriptionPropsMap = {
    [key: string]: CallJobMetadata;
};
export type CallPostProps = {
    title: string;
    start_at: number;
    end_at: number;
    participants: string[];
    recordings: CallRecordingPropsMap;
    transcriptions: CallTranscriptionPropsMap;
};
export type CallCaption = {
    file_id: string;
    language: string;
    title: string;
};
export type CallRecordingPostProps = {
    call_post_id: string;
    recording_id: string;
    captions: CallCaption[];
};
export type HostControlMsg = {
    channel_id: string;
    session_id: string;
};
export type HostControlLowerHand = HostControlMsg & {
    call_id: string;
    host_id: string;
};
export type HostControlRemoved = HostControlMsg & {
    call_id: string;
    user_id: string;
};
export type CallsClientJoinData = {
    channelID: string;
    title?: string;
    threadID?: string;
    jobID?: string;
    av1Support?: boolean;
    dcSignaling?: boolean;
};
export type CallsVersionInfo = {
    version?: string;
    build?: string;
    rtcd_version?: string;
    rtcd_build?: string;
};
