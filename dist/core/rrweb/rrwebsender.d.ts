import type { RRWebChunk } from './rrweborchestrator';
export declare function sendToBackend(chunk: RRWebChunk): Promise<boolean>;
export declare function collectClientInfo(): {
    browser: string;
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
};
//# sourceMappingURL=rrwebsender.d.ts.map