import { SystemTracker } from '../core/tracker';
export interface NpsConfig {
    tracker: SystemTracker;
    question?: string;
    minLabel?: string;
    maxLabel?: string;
    themeColor?: string;
    position?: 'bottom-right' | 'bottom-left' | 'bottom-center' | 'top-right' | 'top-left';
    autoShow?: boolean;
    delay?: number;
    mode?: 'manual' | 'remote';
}
export declare class Nps {
    tracker: SystemTracker;
    config: Required<Omit<NpsConfig, 'tracker'>> & {
        tracker: SystemTracker;
    };
    private container;
    private hasVoted;
    constructor(config: NpsConfig);
    private init;
    private applyRemoteConfig;
    private renderWidget;
    hideForScreenshot(): void;
    showAfterScreenshot(): void;
    private getStep1Template;
    private attachStep1Listeners;
    private renderStep2;
    private submit;
    private showSuccessMessage;
    private showErrorMessage;
    private applyStyles;
    private getPosition;
    open(): void;
    close(): void;
}
//# sourceMappingURL=nps.d.ts.map