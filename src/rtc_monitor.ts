import {EventEmitter} from 'events';

import {Logger, RTCMonitorConfig, RTCLocalInboundStats, RTCRemoteInboundStats, RTCRemoteOutboundStats, RTCLocalOutboundStats} from './types';
import {newRTCLocalInboundStats, newRTCLocalOutboundStats, newRTCRemoteInboundStats, newRTCRemoteOutboundStats} from './rtc_stats';
import {RTCPeer} from './rtc_peer';

export const mosThreshold = 3.5;

type LocalInboundStatsMap = Record<string, RTCLocalInboundStats>;
type LocalOutboundStatsMap = Record<string, RTCLocalOutboundStats>;
type RemoteInboundStatsMap = Record<string, RTCRemoteInboundStats>;
type RemoteOutboundStatsMap = Record<string, RTCRemoteOutboundStats>;

type MonitorStatsSample = {
    lastLocalIn: Record<string, RTCLocalInboundStats | undefined>,
    lastLocalOut: Record<string, RTCLocalOutboundStats | undefined>,
    lastRemoteIn: Record<string, RTCRemoteInboundStats | undefined>,
    lastRemoteOut: Record<string, RTCRemoteOutboundStats | undefined>,
};

type CallQualityStats = {
    avgTime?: number,
    avgLossRate?: number,
    avgJitter?: number,
};

export class RTCMonitor extends EventEmitter {
    private peer: RTCPeer;
    private logger: Logger;
    private cfg: RTCMonitorConfig;
    private intervalID: ReturnType<typeof setInterval> | null;
    private stats: MonitorStatsSample;

    constructor(cfg: RTCMonitorConfig) {
        super();
        this.peer = cfg.peer;
        this.logger = cfg.logger;
        this.cfg = cfg;
        this.intervalID = null;
        this.stats = {
            lastLocalIn: {},
            lastLocalOut: {},
            lastRemoteIn: {},
            lastRemoteOut: {},
        };
    }

    start() {
        if (this.intervalID) {
            return;
        }

        this.logger.logDebug('RTCMonitor: starting');

        this.intervalID = setInterval(this.gatherStats, this.cfg.monitorInterval);
    }

    private gatherStats = async () => {
        this.peer.getStats().then((stats) => {
            this.processStats(stats);
        }).catch((statsErr) => {
            this.logger.logErr('RTCMonitor:', statsErr);
        });
    };

    private getLocalInQualityStats(localIn: LocalInboundStatsMap, remoteOut: RemoteOutboundStatsMap) {
        const stats: CallQualityStats = {};

        let totalTime = 0;
        let totalPacketsReceived = 0;
        let totalPacketsLost = 0;
        let totalJitter = 0;
        let totalLocalStats = 0;

        for (const [ssrc, stat] of Object.entries(localIn)) {
            if (!this.stats.lastLocalIn[ssrc] || !this.stats.lastRemoteOut[ssrc] || stat.timestamp <= this.stats.lastLocalIn[ssrc].timestamp) {
                continue;
            }

            if (stat.packetsReceived === this.stats.lastLocalIn[ssrc].packetsReceived) {
                continue;
            }

            const tsDiff = stat.timestamp - this.stats.lastLocalIn[ssrc].timestamp;
            const receivedDiff = stat.packetsReceived - this.stats.lastLocalIn[ssrc].packetsReceived;

            // Tracking loss on the receiving end is a bit more tricky because packets are
            // forwarded without much modification by the server so if the sender is having issues, these are
            // propagated to the receiver side which may believe it's having problems as a consequence.
            //
            // What we want to know instead is whether the local side is having issues on the
            // server -> receiver path rather than sender -> server -> receiver one.
            // To do this we check for any mismatches in packets sent by the remote and packets
            // received by us.
            //
            // Note: it's expected for local.packetsReceived to be slightly higher than remote.packetsSent
            // since reports are generated at different times, with the local one likely being more time-accurate.
            //
            // Having remote.packetsSent higher than local.packetsReceived is instead a fairly good sign
            // some packets have been lost in transit.
            const potentiallyLost = remoteOut[ssrc].packetsSent - stat.packetsReceived;
            const prevPotentiallyLost = this.stats.lastRemoteOut[ssrc].packetsSent - this.stats.lastLocalIn[ssrc].packetsReceived;
            const lostDiff = prevPotentiallyLost >= 0 && potentiallyLost > prevPotentiallyLost ? potentiallyLost - prevPotentiallyLost : 0;

            totalTime += tsDiff;
            totalPacketsReceived += receivedDiff;
            totalPacketsLost += lostDiff;
            totalJitter += stat.jitter;
            totalLocalStats++;
        }

        if (totalLocalStats > 0) {
            stats.avgTime = totalTime / totalLocalStats;
            stats.avgJitter = totalJitter / totalLocalStats;
        }

        if (totalPacketsReceived > 0) {
            stats.avgLossRate = totalPacketsLost / totalPacketsReceived;
        }

        return stats;
    }

    private getRemoteInQualityStats(remoteIn: RemoteInboundStatsMap, localOut: LocalOutboundStatsMap) {
        const stats: CallQualityStats = {};

        let totalTime = 0;
        let totalRemoteJitter = 0;
        let totalRemoteStats = 0;
        let totalLossRate = 0;
        for (const [ssrc, stat] of Object.entries(remoteIn)) {
            if (!this.stats.lastRemoteIn[ssrc] || stat.timestamp <= this.stats.lastRemoteIn[ssrc].timestamp) {
                continue;
            }

            if (localOut[ssrc].packetsSent === this.stats.lastLocalOut[ssrc]?.packetsSent) {
                continue;
            }

            const tsDiff = stat.timestamp - this.stats.lastRemoteIn[ssrc].timestamp;
            totalTime += tsDiff;
            totalRemoteJitter += stat.jitter;
            totalLossRate += stat.fractionLost;
            totalRemoteStats++;
        }

        if (totalRemoteStats > 0) {
            stats.avgTime = totalTime / totalRemoteStats;
            stats.avgJitter = totalRemoteJitter / totalRemoteStats;
            stats.avgLossRate = totalLossRate / totalRemoteStats;
        }

        return stats;
    }

    private processStats(reports: RTCStatsReport) {
        const localIn: LocalInboundStatsMap = {};
        const localOut: LocalOutboundStatsMap = {};
        const remoteIn: RemoteInboundStatsMap = {};
        const remoteOut: RemoteOutboundStatsMap = {};
        reports.forEach((report: any) => {
            // Collect necessary stats to make further calculations:
            // - inbound-rtp: metrics for incoming RTP media streams.
            // - remote-inbound-rtp: metrics for outgoing RTP media streams as received by the remote endpoint.

            if (report.type === 'inbound-rtp' && report.kind === 'audio') {
                localIn[report.ssrc] = newRTCLocalInboundStats(report);
            }

            if (report.type === 'outbound-rtp' && report.kind === 'audio') {
                localOut[report.ssrc] = newRTCLocalOutboundStats(report);
            }

            if (report.type === 'remote-inbound-rtp' && report.kind === 'audio') {
                remoteIn[report.ssrc] = newRTCRemoteInboundStats(report);
            }

            if (report.type === 'remote-outbound-rtp' && report.kind === 'audio') {
                remoteOut[report.ssrc] = newRTCRemoteOutboundStats(report);
            }
        });

        // Step 1: get transport round-trip time from the peer.
        // This is calculated through ping/pong messages on the data channel.
        const transportRTT = this.peer.getRTT();

        // Step 2: if receiving any stream, calculate average jitter and loss rate using local stats.
        const localInStats = this.getLocalInQualityStats(localIn, remoteOut);

        // Step 3: if sending any stream, calculate average latency, jitter and
        // loss rate using remote stats.
        const remoteInStats = this.getRemoteInQualityStats(remoteIn, localOut);

        // Step 4: cache current stats for calculating deltas on next iteration.
        this.stats.lastLocalIn = {
            ...localIn,
        };
        this.stats.lastLocalOut = {
            ...localOut,
        };
        this.stats.lastRemoteIn = {
            ...remoteIn,
        };
        this.stats.lastRemoteOut = {
            ...remoteOut,
        };

        if (typeof localInStats.avgJitter === 'undefined' && typeof remoteInStats.avgJitter === 'undefined') {
            this.logger.logDebug('RTCMonitor: jitter could not be calculated');
            return;
        }

        if (typeof localInStats.avgLossRate === 'undefined' && typeof remoteInStats.avgLossRate === 'undefined') {
            this.logger.logDebug('RTCMonitor: lossrate could not be calculated');
            return;
        }

        const jitter = Math.max(localInStats.avgJitter || 0, remoteInStats.avgJitter || 0);
        const lossRate = Math.max(localInStats.avgLossRate || 0, remoteInStats.avgLossRate || 0);
        const latency = transportRTT / 2; // approximating one-way latency as RTT/2

        // Step 5 (or the magic step): calculate MOS (Mean Opinion Score)
        // Latency and jitter values are expected to be in ms rather than seconds.
        const mos = this.calculateMOS(latency * 1000, jitter * 1000, lossRate);
        this.emit('mos', mos);
        this.peer.handleMetrics(lossRate, jitter);
        this.logger.logDebug(`RTCMonitor: MOS --> ${mos}`);
    }

    private calculateMOS(latency: number, jitter: number, lossRate: number) {
        this.logger.logDebug(`RTCMonitor: MOS inputs --> latency: ${latency.toFixed(1)}ms jitter: ${jitter.toFixed(1)}ms loss: ${(lossRate * 100).toFixed(2)}%`);

        let R = 0;
        const effectiveLatency = latency + (2 * jitter) + 10.0;

        if (effectiveLatency < 160) {
            R = 93.2 - (effectiveLatency / 40.0);
        } else {
            R = 93.2 - ((effectiveLatency - 120.0) / 10.0);
        }

        R -= 2.5 * (lossRate * 100);

        let MOS = 1;
        if (R >= 0 && R <= 100) {
            MOS = 1 + (0.035 * R) + (0.000007 * R * (R - 60) * (100 - R));
        } else if (R > 100) {
            MOS = 4.5;
        }

        return MOS;
    }

    stop() {
        if (!this.intervalID) {
            return;
        }

        this.logger.logDebug('RTCMonitor: stopping');

        clearInterval(this.intervalID);
        this.intervalID = null;
        this.clearCache();
        this.removeAllListeners('mos');
    }

    clearCache() {
        this.stats = {
            lastLocalIn: {},
            lastLocalOut: {},
            lastRemoteIn: {},
            lastRemoteOut: {},
        };
    }
}
