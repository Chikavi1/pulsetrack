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
    currentScreenshot: string;
    feedbackType: FeedbackType;
    isSubmitting: boolean;
    constructor(config: FeedbackConfig);
    init(): void;
    getPositionClasses(): string;
    toggleFeedbackWindow(): void;
    setFeedbackType(type: FeedbackType, selectedBtn?: HTMLElement): void;
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
}
export declare function Feedback(config: FeedbackConfig): FeedbackWidget;
export {};
//# sourceMappingURL=feedback.d.ts.map