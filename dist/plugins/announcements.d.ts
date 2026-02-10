import { SystemTracker } from '../core/tracker';
export type AnnouncementType = 'info' | 'success' | 'warning' | 'error';
export interface AnnouncementConfig {
    tracker: SystemTracker;
    message?: string;
    linkUrl?: string;
    linkText?: string;
    type?: AnnouncementType;
    themeColor?: string;
    autoShow?: boolean;
    duration?: number;
    dismissible?: boolean;
    pushBody?: boolean;
}
export declare class Announcement {
    tracker: SystemTracker;
    config: Required<Omit<AnnouncementConfig, 'tracker'>> & {
        tracker: SystemTracker;
    };
    container: HTMLDivElement;
    isVisible: boolean;
    closeTimeout?: number;
    originalBodyPaddingTop: string;
    constructor(config: AnnouncementConfig);
    private init;
    /**
     * Normaliza valores (local + remote)
     * No re-lee this.config como fuente
     */
    private applyRemoteConfig;
    private createAnnouncement;
    private updateAnnouncement;
    private getTemplate;
    show(): void;
    private pushBodyDown;
    hide(): void;
    private restoreBody;
    private addStyles;
    private getTypeColor;
}
//# sourceMappingURL=announcements.d.ts.map