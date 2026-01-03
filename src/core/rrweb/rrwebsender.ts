// import type { RRWebChunk } from './rrweborchestrator';

// export async function sendToBackend(chunk: RRWebChunk): Promise<boolean> {
//   try {
//     const isFirstChunk = chunk.events.some(e => e.type === 2);

//     const res = await fetch('http://localhost:3001/sessions/ingest', {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify(chunk),
//       keepalive: !isFirstChunk, // ✅ CLAVE
//     });

//     return res.ok;
//   } catch (err) {
//     console.warn('❌ Error enviando rrweb chunk', err);
//     return false;
//   }
// }


import type { RRWebChunk } from './rrweborchestrator';
 
export async function sendToBackend(chunk: RRWebChunk): Promise<boolean> {
  try {
    const isFirstChunk = chunk.events.some(e => e.type === 2);

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
      keepalive: !isFirstChunk, // ✅ clave para pagehide
    });

    return res.ok;
  } catch (err) {
    console.warn('❌ Error enviando rrweb chunk', err);
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
