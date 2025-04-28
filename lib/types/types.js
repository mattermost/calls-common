// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
export var TranscribeAPI;
(function (TranscribeAPI) {
    TranscribeAPI["WhisperCPP"] = "whisper.cpp";
    TranscribeAPI["AzureAI"] = "azure";
})(TranscribeAPI || (TranscribeAPI = {}));
export const CallsConfigDefault = {
    ICEServers: [],
    ICEServersConfigs: [],
    DefaultEnabled: false,
    MaxCallParticipants: 0,
    NeedsTURNCredentials: false,
    AllowScreenSharing: true,
    EnableRecordings: false,
    MaxRecordingDuration: 60,
    sku_short_name: '',
    EnableSimulcast: false,
    EnableRinging: true,
    EnableTranscriptions: false,
    EnableLiveCaptions: false,
    HostControlsAllowed: false,
    EnableAV1: false,
    TranscribeAPI: TranscribeAPI.WhisperCPP,
    GroupCallsAllowed: false,
    EnableDCSignaling: false,
};
export function isCaption(obj) {
    if (typeof obj !== 'object' || obj === null) {
        return false;
    }
    const caption = obj;
    if (typeof caption.title !== 'string') {
        return false;
    }
    if (typeof caption.language !== 'string') {
        return false;
    }
    if (typeof caption.file_id !== 'string') {
        return false;
    }
    return true;
}
export function isCallJobMetadata(obj) {
    if (typeof obj !== 'object' || obj === null) {
        return false;
    }
    const metadata = obj;
    if (typeof metadata.file_id !== 'string') {
        return false;
    }
    if (typeof metadata.post_id !== 'string') {
        return false;
    }
    // eslint-disable-next-line no-undefined
    if (metadata.tr_id !== undefined && typeof metadata.tr_id !== 'string') {
        return false;
    }
    // eslint-disable-next-line no-undefined
    if (metadata.rec_id !== undefined && typeof metadata.rec_id !== 'string') {
        return false;
    }
    return true;
}
