import { SystemTracker } from '../core/tracker';
type FeedbackType = 'error' | 'suggested' | '';
export interface FeedbackConfig {
    tracker: SystemTracker;
    position?: 'bottom-right' | 'bottom-left' | 'bottom-center';
    themeColor?: string;
    buttonText?: string;
    autoOpen?: boolean;
}
declare class FeedbackWidget {
    tracker: SystemTracker;
    config: Required<Omit<FeedbackConfig, 'tracker'>> & {
        tracker: SystemTracker;
    };
    container: HTMLElement;
    feedbackWindow: HTMLElement;
    isOpen: boolean;
    isSubmitting: boolean;
    feedbackType: FeedbackType;
    currentScreenshot: string;
    constructor(config: FeedbackConfig);
    init(): void;
    getPositionStyle(): "left:16px; bottom:16px;" | "left:50%; bottom:16px; transform:translateX(-50%);" | "right:16px; bottom:16px;";
    toggleFeedbackWindow(): void;
    setFeedbackType(type: FeedbackType): void;
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
}
export declare function Feedback(config: FeedbackConfig): FeedbackWidget;
export {};
//# sourceMappingURL=feedback.d.ts.map