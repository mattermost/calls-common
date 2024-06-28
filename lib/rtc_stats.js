export function newRTCLocalInboundStats(report) {
    return {
        timestamp: report.timestamp,
        // @ts-ignore: mid is missing current version, we need bump some dependencies to fix this.
        mid: report.mid,
        kind: report.kind,
        trackIdentifier: report.trackIdentifier,
        packetsReceived: report.packetsReceived,
        packetsLost: report.packetsLost,
        packetsDiscarded: report.packetsDiscarded,
        bytesReceived: report.bytesReceived,
        nackCount: report.nackCount,
        pliCount: report.pliCount,
        jitter: report.jitter,
        jitterBufferDelay: report.jitterBufferDelay,
    };
}
export function newRTCRemoteInboundStats(report) {
    return {
        timestamp: report.timestamp,
        kind: report.kind,
        packetsLost: report.packetsLost,
        fractionLost: report.fractionLost,
        jitter: report.jitter,
        roundTripTime: report.roundTripTime,
    };
}
export function newRTCCandidatePairStats(report, reports) {
    let local;
    let remote;
    reports.forEach((r) => {
        if (r.id === report.localCandidateId) {
            local = r;
        }
        else if (r.id === report.remoteCandidateId) {
            remote = r;
        }
    });
    return {
        id: report.id,
        timestamp: report.timestamp,
        priority: report.priority,
        packetsSent: report.packetsSent,
        packetsReceived: report.packetsReceived,
        currentRoundTripTime: report.currentRoundTripTime,
        totalRoundTripTime: report.totalRoundTripTime,
        nominated: report.nominated,
        state: report.state,
        local,
        remote,
    };
}
export function parseSSRCStats(reports) {
    const stats = {};
    reports.forEach((report) => {
        if (!report.ssrc) {
            return;
        }
        if (!stats[report.ssrc]) {
            stats[report.ssrc] = {
                local: {},
                remote: {},
            };
        }
        switch (report.type) {
            case 'inbound-rtp':
                stats[report.ssrc].local.in = newRTCLocalInboundStats(report);
                break;
            case 'outbound-rtp':
                stats[report.ssrc].local.out = {
                    timestamp: report.timestamp,
                    // @ts-ignore: mid is missing in current version, we need bump some dependencies to fix this.
                    mid: report.mid,
                    kind: report.kind,
                    packetsSent: report.packetsSent,
                    bytesSent: report.bytesSent,
                    retransmittedPacketsSent: report.retransmittedPacketsSent,
                    retransmittedBytesSent: report.retransmittedBytesSent,
                    nackCount: report.nackCount,
                    pliCount: report.pliCount,
                    targetBitrate: report.targetBitrate,
                };
                break;
            case 'remote-inbound-rtp':
                stats[report.ssrc].remote.in = newRTCRemoteInboundStats(report);
                break;
            case 'remote-outbound-rtp':
                stats[report.ssrc].remote.out = {
                    timestamp: report.timestamp,
                    kind: report.kind,
                    packetsSent: report.packetsSent,
                    bytesSent: report.bytesSent,
                };
                break;
        }
    });
    return stats;
}
export function parseICEStats(reports) {
    const stats = {};
    reports.forEach((report) => {
        if (report.type !== 'candidate-pair') {
            return;
        }
        if (!stats[report.state]) {
            stats[report.state] = [];
        }
        stats[report.state].push(newRTCCandidatePairStats(report, reports));
    });
    // We sort pairs so that first values are those nominated and/or have the highest priority.
    for (const pairs of Object.values(stats)) {
        pairs.sort((a, b) => {
            var _a, _b;
            if (a.nominated && !b.nominated) {
                return -1;
            }
            if (b.nominated && !a.nominated) {
                return 1;
            }
            // Highest priority should come first.
            return ((_a = b.priority) !== null && _a !== void 0 ? _a : 0) - ((_b = a.priority) !== null && _b !== void 0 ? _b : 0);
        });
    }
    return stats;
}
export function parseRTCStats(reports) {
    return {
        ssrcStats: parseSSRCStats(reports),
        iceStats: parseICEStats(reports),
    };
}
