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
})(DCMessageType || (DCMessageType = {}));
