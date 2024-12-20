import { EventEmitter } from 'events';
import { RTCMonitorConfig } from './types';
export declare const mosThreshold = 3.5;
export declare class RTCMonitor extends EventEmitter {
    private peer;
    private logger;
    private cfg;
    private intervalID;
    private stats;
    constructor(cfg: RTCMonitorConfig);
    start(): void;
    private gatherStats;
    private getLocalInQualityStats;
    private getRemoteInQualityStats;
    private processStats;
    private calculateMOS;
    stop(): void;
    clearCache(): void;
}
