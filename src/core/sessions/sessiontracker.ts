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
      checkoutEveryNms: 30_000,
      maskTextClass: 'pt-sensitive',
      ignoreClass: 'pt-ignore',
      blockClass: 'pt-block',

      maskTextSelector: '[data-sensitive="true"]',
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
    this.addTag('error', {
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
