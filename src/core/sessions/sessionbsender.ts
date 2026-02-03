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
      clientInfo: isFirstChunk ? await collectClientInfo() : undefined,
    };

    const res = await fetch('https://api.rojastudio.xyz/sessions/ingest', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': 'Bearer ' + payload.token,
      },
      body: JSON.stringify(payload),
      keepalive: isExit, 
    });

    return res.ok;
  } catch {
    return false;
  }
}



export async function collectClientInfo() {
  return {
    browser: await detectBrowser(),
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

async function detectBrowser() {
  const nav = navigator as any;

  if (nav.userAgentData?.brands?.length) {
    return nav.userAgentData.brands
      .map((b: any) => b.brand)
      .join(', ');
  }

  const ua = navigator.userAgent;

  if (/Firefox\/\d+/i.test(ua)) return 'Firefox';
  if (/Edg\/\d+/i.test(ua)) return 'Edge';
  if (/Brave/i.test(ua)) return 'Brave';
  if (/Chrome\/\d+/i.test(ua)) return 'Chrome';
  if (/Safari\/\d+/i.test(ua)) return 'Safari';

  return 'Unknown';
}

