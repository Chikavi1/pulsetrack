import type { RRWebChunk } from './sessionorchestrator';

export async function sendToBackend(chunk: RRWebChunk): Promise<boolean> {
  try {
    const isFirstChunk = chunk.events.some(e => e.type === 2);
    const isExit =
      chunk.reason === 'pagehide' ||
      chunk.reason === 'unload';

    const payload = {
      ...chunk,
      pageUrl: location.href,
      referrer: document.referrer,
      clientInfo: isFirstChunk ? collectClientInfo() : undefined,
    };

    const res = await fetch('http://localhost:3001/sessions/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: isExit, // 🔑 solo salida real
    });

    return res.ok;
  } catch {
    return false;
  }
}



export function collectClientInfo() {
  return {
    browser: navigator.userAgent,
    language: navigator.language,
    languages: navigator.languages,
    platform: navigator.platform,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    deviceType: /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
    isBot: false,
    fingerprint: null,
    screen: {
      width: window.screen.width,
      height: window.screen.height,
      dpr: window.devicePixelRatio,
    },

    hardware: {
      memory: (navigator as any).deviceMemory ?? null,
      cores: navigator.hardwareConcurrency ?? null,
    },
  };
}
