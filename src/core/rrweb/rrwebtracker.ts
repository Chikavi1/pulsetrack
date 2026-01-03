import { record } from 'rrweb';
import type { eventWithTime } from '@rrweb/types';

export type RRWebEvent = eventWithTime;

export class RRWebTracker {
  private buffer: RRWebEvent[] = [];
  private stopFn: (() => void) | null = null;
  private recording = false;
  private hasFullSnapshot = false;

  /* =========================
     START RECORDING
  ========================= */

  start() {
    if (this.recording) return;

    const stop = record({
      emit: (event: RRWebEvent) => {
        // 📸 Detectar FullSnapshot (necesario para replay)
        if (event.type === 2) {
          this.hasFullSnapshot = true;
          console.log('📸 FullSnapshot recibido');
        }

        // 👉 Aquí entran TODOS los eventos
        // DOM, clicks, scrolls y TAMBIÉN los tags (type 5)
        this.buffer.push(event);
      },

      // 🔁 Fuerza snapshots completos periódicos
      checkoutEveryNms: 30_000,

      // 🔐 Privacidad / Masking
      maskTextClass: 'pt-sensitive',
      ignoreClass: 'pt-ignore',
      blockClass: 'pt-block',

      // Mask dinámico por atributo
      maskTextSelector: '[data-sensitive="true"]',
    });

    this.stopFn = stop ?? null;
    this.recording = true;

    console.log('✅ RRWebTracker iniciado');
  }

  /* =========================
     TAGS (CUSTOM EVENTS)
  ========================= */

  /**
   * Agrega un tag a la sesión (error, rage-click, conversion, etc)
   */
  addTag(type: string, data: Record<string, any> = {}) {
    if (!this.recording) return;

    record.addCustomEvent('tag', {
      type,
      ...data,
    });
  }

  /* =========================
     TAG HELPERS (OPCIONAL)
  ========================= */

  addErrorTag(error: Error) {
    this.addTag('error', {
      message: error.message,
      stack: error.stack,
    });
  }

  addRageClickTag(count: number) {
    this.addTag('rage-click', {
      count,
    });
  }

  addConversionTag(step: string) {
    this.addTag('conversion', {
      step,
    });
  }

  /* =========================
     BUFFER CONTROL
  ========================= */

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

  /* =========================
     STOP RECORDING
  ========================= */

  stop() {
    this.stopFn?.();
    this.stopFn = null;
    this.recording = false;
    console.log('🛑 RRWebTracker detenido');
  }

  isRecording() {
    return this.recording;
  }
}
