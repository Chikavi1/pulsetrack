import { Session, EventData } from './interfaces';
export interface SessionStorageOptions {
    storageKey?: string;
    inactivityMs?: number;
    businessId?: string;
    credentials?: RequestCredentials;
    useBeacon?: boolean;
}
export type FlushReason = 'pagehide' | 'visibility' | 'inactivity' | 'manual' | 'feedback' | 'navigation';
export declare class SessionStorageService {
    private options;
    private storageKey;
    private metaKey;
    private session;
    private sessionStartMs;
    private inactivityTimer;
    private isSending;
    private disabled;
    private endpoint;
    constructor(options?: SessionStorageOptions);
    private isSPA;
    private getUser;
    createNewSession(): Session;
    loadSession(): Session;
    saveSession(): void;
    restartSession(): Session;
    startAutoFlush(): void;
    stopAutoFlush(): void;
    onPageChange(newPage: string): void;
    addEvent(type: string, data?: EventData): void;
    updateScrollPercentage(percent: number): void;
    flushNow(reason?: FlushReason): Promise<boolean>;
    private sendPayload;
    private ensureCurrentPage;
    private addDuration;
    private getPage;
    private pushPageHistory;
    private resetInactivityTimer;
    private readMeta;
    private writeMeta;
    private requireSession;
    private handlePageHide;
    private handleVisibilityChange;
    private handleStorageEvent;
    setFingerprint(fingerprint: string | null): void;
}
export default SessionStorageService;
//# sourceMappingURL=SessionStorageService.d.ts.map