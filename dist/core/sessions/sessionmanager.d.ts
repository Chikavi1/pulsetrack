export default class SessionManager {
    private static KEY;
    private static MAX_DURATION_MS;
    static getSession(): any;
    static getSessionId(): string;
    static isExpired(): boolean;
    static createSession(expired?: boolean): {
        id: `${string}-${string}-${string}-${string}-${string}`;
        startedAt: number;
        expiredFromPrevious: boolean;
    };
    static reset(): void;
}
//# sourceMappingURL=sessionmanager.d.ts.map