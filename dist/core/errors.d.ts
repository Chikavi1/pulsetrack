import { TrackedError } from './interfaces';
type ErrorHandler = (error: TrackedError) => void;
export declare class ErrorsTracker {
    private onError;
    private pageUrl;
    private seen;
    constructor(onError: ErrorHandler);
    init(): void;
    private handleError;
    private handleRejection;
    private record;
    private generateErrorHash;
}
export {};
//# sourceMappingURL=errors.d.ts.map