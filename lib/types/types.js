// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
export var TranscribeAPI;
(function (TranscribeAPI) {
    TranscribeAPI["WhisperCPP"] = "whisper.cpp";
    TranscribeAPI["AzureAI"] = "azure";
})(TranscribeAPI || (TranscribeAPI = {}));
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
