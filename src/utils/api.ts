import { getConfig } from '../core/config';

export function getApiBaseUrl(): string {
  const config = getConfig();
  return config.endpoint || 'https://api.rojastudio.xyz';
}

export function getApiUrl(path: string): string {
  const baseUrl = getApiBaseUrl();
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
