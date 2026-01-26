export interface PulseConfig {
    token: string;
    endpoint?: string;
    remote?: boolean;
    environment?: 'dev' | 'prod';
    announcement?: Record<string, any>;
}
export declare function initConfig(userConfig: PulseConfig): void;
export declare function getConfig(): PulseConfig;
//# sourceMappingURL=config.d.ts.map