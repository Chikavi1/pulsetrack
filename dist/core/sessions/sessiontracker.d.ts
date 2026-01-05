import type { eventWithTime } from '@rrweb/types';
import { TrackedError } from '../interfaces';
export type RRWebEvent = eventWithTime;
export declare class RRWebTracker {
    private buffer;
    private stopFn;
    private recording;
    private hasFullSnapshot;
    start(): void;
    addTag(type: string, data?: Record<string, any>): void;
    addErrorTag(error: TrackedError): void;
    addRageClickTag(count: number): void;
    addConversionTag(step: string): void;
    canFlush(): boolean;
    getBufferSize(): number;
    peek(): RRWebEvent[];
    commit(): void;
    stop(): void;
    isRecording(): boolean;
}
//# sourceMappingURL=sessiontracker.d.ts.map