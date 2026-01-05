import { RRWebTracker, RRWebEvent } from './rrwebtracker';
export interface RRWebChunk {
    sessionId: string;
    events: RRWebEvent[];
    sentAt: number;
    businessId?: string;
    reason?: 'interval' | 'max-events' | 'visibility' | 'pagehide' | 'unload' | 'expired';
}
export declare class RRWebOrchestrator {
    private tracker;
    private sendFn;
    private intervalId;
    private flushing;
    private readonly FLUSH_INTERVAL;
    private readonly MAX_EVENTS;
    constructor(tracker: RRWebTracker, sendFn: (chunk: RRWebChunk) => Promise<boolean>);
    start(): void;
    stop(): void;
    onEventTick(): void;
    flush(force?: boolean, reason?: RRWebChunk['reason']): Promise<void>;
}
//# sourceMappingURL=rrweborchestrator.d.ts.map