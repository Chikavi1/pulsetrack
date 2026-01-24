import { record } from 'rrweb';
import type { eventWithTime } from '@rrweb/types';
import { TrackedError } from '../interfaces';

export type RRWebEvent = eventWithTime;

export class RRWebTracker {
  private buffer: RRWebEvent[] = [];
  private stopFn: (() => void) | null = null;
  private recording = false;
  private hasFullSnapshot = false;

  start() {
  if (this.recording) return;

  const stop = record({
    emit: (event: RRWebEvent) => {
      if (event.type === 2) this.hasFullSnapshot = true;
      this.buffer.push(event);
    },

    // 🧠 SNAPSHOTS
    checkoutEveryNms: 60_000, // ⬅️ más largo, menos peso
    checkoutEveryNth: 0,

    sampling: {
      mousemove: false,      // ⬅️ mata MBs
      mouseInteraction: true,
      scroll: 200,           // 1 evento cada 200ms
      input: 'last',         // solo valor final
      media: 0,
      canvas: 0,
    },

    // 🧼 PRIVACIDAD / OPTIMIZACIÓN
    maskTextClass: 'pt-sensitive',
    maskTextSelector: '[data-sensitive="true"]',
    ignoreClass: 'pt-ignore',
    blockClass: 'pt-block',

      
  });

  this.stopFn = stop ?? null;
  this.recording = true;
}


  addTag(type: string, data: Record<string, any> = {}) {
    if (!this.recording) return;
    record.addCustomEvent('tag', {
      type,
      ...data,
    });
  }

  addErrorTag(error: TrackedError) {
    record.addCustomEvent('error', {
      message: error.message,
      stack: error.stack,
      hash: error.hash,
    });
  }

  addRageClickTag(count: number) {
    this.addTag('rage-click', { count });
  }

  addConversionTag(step: string) {
    this.addTag('conversion', { step });
  }

  canFlush() {
    return this.hasFullSnapshot;
  }

  getBufferSize() {
    return this.buffer.length;
  }

  peek(): RRWebEvent[] {
    return [...this.buffer];
  }

  commit() {
    this.buffer = [];
  }

  stop() {
    this.stopFn?.();
    this.stopFn = null;
    this.recording = false;
  }

  isRecording() {
    return this.recording;
  }
}
