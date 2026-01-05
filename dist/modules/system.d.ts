interface SystemTrackerAPI {
    /** Initialize the tracker */
    init(): void;
    /** Start or resume tracking */
    start(): void;
    /** Pause tracking */
    pause(): void;
    /** Stop tracking and flush events */
    stop(): void;
    /** Reset tracker to initial state */
    reset(): void;
    /** Get current tracking data */
    getData(): void;
    /** Track a custom event */
    addTag(type: string, payload?: any): void;
}
export declare const systemTracker: SystemTrackerAPI;
export {};
//# sourceMappingURL=system.d.ts.map