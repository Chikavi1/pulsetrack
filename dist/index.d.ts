import { SystemTracker } from './core/tracker';
import { Feedback as FeedbackFactory } from './plugins/feedback';
export declare const PulseTrack: {
    init(config: {
        businessId: string;
    }): void;
    tracker(): SystemTracker;
    Feedback(options?: Omit<Parameters<typeof FeedbackFactory>[0], "tracker">): {
        tracker: SystemTracker;
        config: Required<Omit<import("./plugins/feedback").FeedbackConfig, "tracker">> & {
            tracker: SystemTracker;
        };
        container: HTMLElement;
        feedbackWindow: HTMLElement;
        isOpen: boolean;
        currentScreenshot: string;
        feedbackType: "" | "error" | "suggested";
        isSubmitting: boolean;
        init(): void;
        getPositionClasses(): string;
        toggleFeedbackWindow(): void;
        setFeedbackType(type: "" | "error" | "suggested", selectedBtn?: HTMLElement): void;
        toggleForm(enable: boolean): void;
        captureScreenshot(): Promise<void>;
        removeScreenshot(): void;
        getFingerprint(): Promise<string | null>;
        getUser(): string;
        submitFeedback(): Promise<void>;
        base64ToBlob(base64: string): Blob;
        resetForm(): void;
        createButton(): void;
        createFeedbackWindow(): void;
        addStyles(): void;
    };
};
//# sourceMappingURL=index.d.ts.map