export interface PulseConfig {
    businessId: string;
    endpoint?: string;
    environment?: 'dev' | 'prod';
}
export declare function initConfig(userConfig: PulseConfig): void;
export declare function getConfig(): PulseConfig;
//# sourceMappingURL=config.d.ts.map