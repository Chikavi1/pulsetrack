export interface PulseConfig {
  businessId: string;
  endpoint?: string;
  environment?: 'dev' | 'prod';
}

let config: PulseConfig | null = null;

export function initConfig(userConfig: PulseConfig) {
  if (config) {
    console.warn('PulseTrack already initialized');
    return;
  }

  config = {
    endpoint: 'https://dev.rojastudio.xyz',
    environment: 'prod',
    ...userConfig,
  };
}

export function getConfig(): PulseConfig {
  if (!config) {
    throw new Error('PulseTrack not initialized. Call PulseTrack.init() first.');
  }
  return config;
}
