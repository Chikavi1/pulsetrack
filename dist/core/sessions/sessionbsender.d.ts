import type { RRWebChunk } from './sessionorchestrator';
export declare function sendToBackend(chunk: RRWebChunk): Promise<boolean>;
export declare function collectClientInfo(): Promise<{
    browser: any;
    language: string;
    languages: readonly string[];
    platform: string;
    timezone: string;
    deviceType: string;
    isBot: boolean;
    fingerprint: null;
    screen: {
        width: number;
        height: number;
        dpr: number;
    };
    hardware: {
        memory: any;
        cores: number;
    };
}>;
//# sourceMappingURL=sessionbsender.d.ts.map