import { SystemTracker } from './core/tracker';
import { Announcement } from './plugins/announcements';
import { Feedback as FeedbackFactory } from './plugins/feedback';
import { AnnouncementConfig } from './plugins/announcements';
import { Nps, NpsConfig } from './plugins/nps';
export declare const PulseTrack: {
    init(config: {
        token: string;
        remote?: boolean;
        [key: string]: any;
    }): Promise<void>;
    ensureReady(): Promise<void>;
    tracker(): SystemTracker;
    Feedback(options?: Omit<Parameters<typeof FeedbackFactory>[0], "tracker">): Promise<{
        tracker: SystemTracker;
        config: Required<Omit<import("./plugins/feedback").FeedbackConfig, "tracker">> & {
            tracker: SystemTracker;
        };
        container: HTMLElement;
        feedbackWindow: HTMLElement;
        isOpen: boolean;
        isSubmitting: boolean;
        feedbackType: "" | "error" | "suggested";
        currentScreenshot: string;
        init(): void;
        getPositionStyle(): "left:16px; bottom:16px;" | "left:50%; bottom:16px; transform:translateX(-50%);" | "right:16px; bottom:16px;";
        toggleFeedbackWindow(): void;
        setFeedbackType(type: "" | "error" | "suggested"): void;
        captureScreenshot(): Promise<void>;
        removeScreenshot(): void;
        getFingerprint(): Promise<string>;
        getUser(): string;
        base64ToBlob(base64: string): Blob;
        submitFeedback(): Promise<void>;
        resetForm(): void;
        createButton(): void;
        createFeedbackWindow(): void;
        addStyles(): void;
    }>;
    Announcement(options?: Omit<AnnouncementConfig, "tracker">): Promise<Announcement>;
    Nps(options?: Omit<NpsConfig, "tracker">): Promise<Nps>;
};
//# sourceMappingURL=index.d.ts.map