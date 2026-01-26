export interface PulseConfig {
  token: string;
  endpoint?: string;
  remote?: boolean;
  environment?: 'dev' | 'prod';
  announcement?: Record<string, any>;
}

let config: PulseConfig | null = null;

export function initConfig(userConfig: PulseConfig) {
  if (config) {
    console.warn('PulseTrack already initialized');
    return;
  }

  config = {
    endpoint: 'http://localhost:3000',
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
