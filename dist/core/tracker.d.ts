import { TrackedError } from './interfaces';
export interface TrackerOptions {
    businessId?: string;
}
export declare class SystemTracker {
    private options;
    private rrwebTracker;
    private rrwebOrchestrator;
    private errorsTracker;
    private isPaused;
    private errors;
    constructor(options?: TrackerOptions);
    init(): void;
    start(): void;
    pause(): void;
    resume(): void;
    stop(): void;
    private handleError;
    addTag(type: string, payload?: any): void;
    private addErrorTag;
    getData(): {
        errors: TrackedError[];
        rrweb: import("@rrweb/types").eventWithTime[];
    };
    reset(): void;
}
//# sourceMappingURL=tracker.d.ts.map