import { RRWebTracker, RRWebEvent } from './sessiontracker';
import SessionManager from './sessionmanager';

export interface RRWebChunk {
  sessionId: string;
  events: RRWebEvent[];
  sentAt: number;
  businessId?: string;
  reason?: 'interval' | 'max-events' | 'visibility' | 'pagehide' | 'unload' | 'expired';
}

export class RRWebOrchestrator {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  private readonly FLUSH_INTERVAL = 5000;
  private readonly MAX_EVENTS = 80;

  constructor(
    private tracker: RRWebTracker,
    private sendFn: (chunk: RRWebChunk) => Promise<boolean>
  ) {}

  start() {
    this.tracker.start();

    this.intervalId = setInterval(() => {
      this.flush(false, 'interval');
    }, this.FLUSH_INTERVAL);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.flush(true, 'visibility');
      }
    });

    window.addEventListener('pagehide', () => {
      this.flush(true, 'pagehide');
    });

    window.addEventListener('beforeunload', () => {
      this.flush(true, 'unload');
    });
  }

  stop() {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = null;
    this.tracker.stop();
  }

  onEventTick() {
    if (this.tracker.getBufferSize() >= this.MAX_EVENTS) {
      this.flush(false, 'max-events');
    }
  }

  async flush(
    force = false,
    reason: RRWebChunk['reason'] = 'interval'
  ) {
    if (this.flushing) return;

    if (SessionManager.isExpired()) {
      const events = this.tracker.peek();

      if (events.length) {
        await this.sendFn({
          sessionId: SessionManager.getSessionId(),
          events,
          sentAt: Date.now(),
          reason: 'expired',
        });

        this.tracker.commit();
      }

      this.tracker.stop();
      SessionManager.reset();
      this.tracker.start();
      return;
    }

    if (!this.tracker.canFlush() && !force) return;

    const events = this.tracker.peek();
    if (!events.length) return;

    this.flushing = true;

    const ok = await this.sendFn({
      sessionId: SessionManager.getSessionId(),
      events,
      sentAt: Date.now(),
      reason,
    });

    if (ok) {
      this.tracker.commit();
    }

    this.flushing = false;
  }
}
