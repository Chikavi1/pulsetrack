export declare class botTracker {
    private botDetector;
    private botInfo;
    private endpoint;
    events: any;
    options: any;
    constructor(events?: any, options?: any);
    initBotDetection(): Promise<void>;
    isBot(): boolean;
    isBotAsync(): Promise<boolean>;
    private sendBotStatus;
    private showBotBlockMessage;
    private handleBotView;
}
export interface BotDetectionResult {
    isBot: boolean;
    score: number;
    reasons: string[];
    incognito: boolean;
    vpn: boolean | null;
}
export declare class BotDetector {
    private vpnCheckUrl;
    constructor(vpnCheckUrl?: string);
    detect(): Promise<BotDetectionResult>;
    private detectCanvasAnomaly;
    private detectIncognito;
}
//# sourceMappingURL=bot.d.ts.map