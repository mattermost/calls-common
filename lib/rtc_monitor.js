var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { EventEmitter } from 'events';
import { newRTCLocalInboundStats, newRTCRemoteInboundStats, newRTCCandidatePairStats } from './rtc_stats';
export class RTCMonitor extends EventEmitter {
    constructor(cfg) {
        super();
        this.gatherStats = () => __awaiter(this, void 0, void 0, function* () {
            this.peer.getStats().then((stats) => {
                this.processStats(stats);
            }).catch((statsErr) => {
                this.logger.logErr('RTCMonitor:', statsErr);
            });
        });
        this.peer = cfg.peer;
        this.logger = cfg.logger;
        this.cfg = cfg;
        this.intervalID = null;
        this.stats = {
            lastLocalIn: {},
            lastRemoteIn: {},
        };
    }
    start() {
        if (this.intervalID) {
            return;
        }
        this.logger.logDebug('RTCMonitor: starting');
        this.intervalID = setInterval(this.gatherStats, this.cfg.monitorInterval);
    }
    getLocalInQualityStats(localIn) {
        const stats = {};
        let totalTime = 0;
        let totalPacketsReceived = 0;
        let totalPacketsLost = 0;
        let totalJitter = 0;
        let totalLocalStats = 0;
        for (const [ssrc, stat] of Object.entries(localIn)) {
            if (!this.stats.lastLocalIn[ssrc] || stat.timestamp <= this.stats.lastLocalIn[ssrc].timestamp) {
                continue;
            }
            if (stat.packetsReceived === this.stats.lastLocalIn[ssrc].packetsReceived) {
                continue;
            }
            const tsDiff = stat.timestamp - this.stats.lastLocalIn[ssrc].timestamp;
            const receivedDiff = stat.packetsReceived - this.stats.lastLocalIn[ssrc].packetsReceived;
            const lostDiff = stat.packetsLost - this.stats.lastLocalIn[ssrc].packetsLost;
            totalTime += tsDiff;
            totalPacketsReceived += receivedDiff;
            totalPacketsLost += lostDiff;
            totalJitter += stat.jitter;
            totalLocalStats++;
        }
        if (totalLocalStats > 0) {
            stats.avgTime = totalTime / totalLocalStats;
            stats.avgJitter = (totalJitter / totalLocalStats) * 1000;
        }
        if (totalPacketsReceived > 0) {
            stats.avgLossRate = totalPacketsLost / totalPacketsReceived;
        }
        return stats;
    }
    getRemoteInQualityStats(remoteIn) {
        const stats = {};
        let totalTime = 0;
        let totalRTT = 0;
        let totalRemoteJitter = 0;
        let totalRemoteStats = 0;
        let totalLossRate = 0;
        for (const [ssrc, stat] of Object.entries(remoteIn)) {
            if (!this.stats.lastRemoteIn[ssrc] || stat.timestamp <= this.stats.lastRemoteIn[ssrc].timestamp) {
                continue;
            }
            const tsDiff = stat.timestamp - this.stats.lastRemoteIn[ssrc].timestamp;
            totalTime += tsDiff;
            totalRemoteJitter += stat.jitter;
            totalRTT += stat.roundTripTime;
            totalLossRate = stat.fractionLost;
            totalRemoteStats++;
        }
        if (totalRemoteStats > 0) {
            stats.avgTime = totalTime / totalRemoteStats;
            stats.avgJitter = (totalRemoteJitter / totalRemoteStats) * 1000;
            stats.avgLatency = (totalRTT / totalRemoteStats) * (1000 / 2);
            stats.avgLossRate = totalLossRate / totalRemoteStats;
        }
        return stats;
    }
    processStats(reports) {
        const localIn = {};
        const remoteIn = {};
        let candidate;
        // Step 0: pre-process the raw reports a bit and turn them into usable
        // objects.
        reports.forEach((report) => {
            // Collect necessary stats to make further calculations:
            // - candidate-pair: transport level metrics.
            // - inbound-rtp: metrics for incoming RTP media streams.
            // - remote-inbound-rtp: metrics for outgoing RTP media streams as received by the remote endpoint.
            if (report.type === 'candidate-pair' && report.nominated) {
                if (!candidate || (report.priority && candidate.priority && report.priority > candidate.priority)) {
                    candidate = newRTCCandidatePairStats(report);
                }
            }
            if (report.type === 'inbound-rtp' && report.kind === 'audio') {
                localIn[report.ssrc] = newRTCLocalInboundStats(report);
            }
            if (report.type === 'remote-inbound-rtp' && report.kind === 'audio') {
                remoteIn[report.ssrc] = newRTCRemoteInboundStats(report);
            }
        });
        if (!candidate) {
            this.logger.logDebug('RTCMonitor: no valid candidate was found');
            return;
        }
        // Step 1: get transport latency from the in-use candidate pair stats, if present.
        let transportLatency;
        // currentRoundTripTime could be missing in the original report (e.g. on Firefox) and implicitly coverted to NaN.
        if (!isNaN(candidate.currentRoundTripTime)) {
            transportLatency = (candidate.currentRoundTripTime * 1000) / 2;
        }
        // Step 2: if receiving any stream, calculate average jitter and loss rate using local stats.
        const localInStats = this.getLocalInQualityStats(localIn);
        // Step 3: if sending any stream, calculate average latency, jitter and
        // loss rate using remote stats.
        const remoteInStats = this.getRemoteInQualityStats(remoteIn);
        // Step 4: cache current stats for calculating deltas on next iteration.
        this.stats.lastLocalIn = Object.assign({}, localIn);
        this.stats.lastRemoteIn = Object.assign({}, remoteIn);
        if (typeof transportLatency === 'undefined' && typeof remoteInStats.avgLatency === 'undefined') {
            transportLatency = this.peer.getRTT() / 2;
        }
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
        const latency = transportLatency !== null && transportLatency !== void 0 ? transportLatency : remoteInStats.avgLatency;
        // Step 5 (or the magic step): calculate MOS (Mean Opinion Score)
        const mos = this.calculateMOS(latency, jitter, lossRate);
        this.emit('mos', mos);
        this.logger.logDebug(`RTCMonitor: MOS --> ${mos}`);
    }
    calculateMOS(latency, jitter, lossRate) {
        this.logger.logDebug(`RTCMonitor: MOS inputs --> latency: ${latency} jitter: ${jitter} loss: ${lossRate}`);
        let R = 0;
        const effectiveLatency = latency + (2 * jitter) + 10.0;
        if (effectiveLatency < 160) {
            R = 93.2 - (effectiveLatency / 40.0);
        }
        else {
            R = 93.2 - ((effectiveLatency - 120.0) / 10.0);
        }
        R -= 2.5 * (lossRate * 100);
        let MOS = 1;
        if (R >= 0 && R <= 100) {
            MOS = 1 + (0.035 * R) + (0.000007 * R * (R - 60) * (100 - R));
        }
        else if (R > 100) {
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
            lastRemoteIn: {},
        };
    }
}
