export var DCMessageType;
(function (DCMessageType) {
    DCMessageType[DCMessageType["Ping"] = 1] = "Ping";
    DCMessageType[DCMessageType["Pong"] = 2] = "Pong";
    DCMessageType[DCMessageType["SDP"] = 3] = "SDP";
    DCMessageType[DCMessageType["LossRate"] = 4] = "LossRate";
    DCMessageType[DCMessageType["RoundTripTime"] = 5] = "RoundTripTime";
    DCMessageType[DCMessageType["Jitter"] = 6] = "Jitter";
    DCMessageType[DCMessageType["Lock"] = 7] = "Lock";
    DCMessageType[DCMessageType["Unlock"] = 8] = "Unlock";
    DCMessageType[DCMessageType["MediaMap"] = 9] = "MediaMap";
    DCMessageType[DCMessageType["CodecSupportMap"] = 10] = "CodecSupportMap";
})(DCMessageType || (DCMessageType = {}));
export var CodecSupportLevel;
(function (CodecSupportLevel) {
    CodecSupportLevel[CodecSupportLevel["None"] = 0] = "None";
    CodecSupportLevel[CodecSupportLevel["Partial"] = 1] = "Partial";
    CodecSupportLevel[CodecSupportLevel["Full"] = 2] = "Full";
})(CodecSupportLevel || (CodecSupportLevel = {}));
export var CodecMimeType;
(function (CodecMimeType) {
    CodecMimeType["AV1"] = "video/AV1";
    CodecMimeType["VP8"] = "video/VP8";
})(CodecMimeType || (CodecMimeType = {}));
export const DCMessageCodecSupportMapDefault = {
    [CodecMimeType.AV1]: CodecSupportLevel.None,
    [CodecMimeType.VP8]: CodecSupportLevel.Full,
};
