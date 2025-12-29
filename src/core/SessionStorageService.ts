import { Session, PageSession, Event as PtEvent, EventData, RecordedEvent } from './interfaces';

export interface SessionStorageOptions {
  storageKey?: string;
  inactivityMs?: number;
  businessId?: string;
  credentials?: RequestCredentials;
  useBeacon?: boolean;
}

export type FlushReason =
  | 'pagehide'
  | 'visibility'
  | 'inactivity'
  | 'manual'
  | 'feedback'
  | 'navigation';

interface MetaState {
  sessionId: string;
  currentPage: string;
  pageStart: number;
  lastActivity: number;
  finalized: boolean;
}

export class SessionStorageService {
  private options: Required<SessionStorageOptions>;
  private storageKey: string;
  private metaKey: string;

  private session: Session | null = null;
  private sessionStartMs = 0;
  private inactivityTimer: number | null = null;
  private isSending = false;
  private disabled = false;

  private endpoint = 'http://localhost:3001/sessions';

  constructor(options: SessionStorageOptions = {}) {
    this.options = {
      storageKey: options.storageKey ?? 'pt:session:v1',
      inactivityMs: options.inactivityMs ?? 30000,
      businessId: options.businessId ?? undefined,
      credentials: options.credentials ?? 'include',
      useBeacon: options.useBeacon ?? true,
    } as Required<SessionStorageOptions>;

    this.storageKey = this.options.storageKey;
    this.metaKey = `${this.storageKey}:meta`;
  }

  /* =====================
     Session lifecycle
  ===================== */

  createNewSession(): Session {
    const now = Date.now();
    const page = location.pathname;

    const sess: Session = {
      id: `sess_${now}`,
      createdAt: new Date(now).toISOString(),
      userId: this.getUser() ?? undefined,
      errors: [],
      userInfo: {
        browser: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        deviceType: /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
        screen: { width: window.innerWidth, height: window.innerHeight },
        fingerprint: null,
        isBot: false,
      },
      pageHistory: [],
      pages: [],
      entryPage: page,
      exitPage: page,
      systemEvents: [],
      totalClicks: 0,
      totalInputs: 0,
      totalPagesVisited: 0,
      rrwebEvents: [],
    };

    this.session = sess;
    this.sessionStartMs = now;

    this.ensureCurrentPage(page);
    this.pushPageHistory(page, null, now);

    this.writeMeta({
      sessionId: sess.id,
      currentPage: page,
      pageStart: now,
      lastActivity: now,
      finalized: false,
    });

    this.saveSession();
    return sess;
  }

  loadSession(): Session {
    const raw = localStorage.getItem(this.storageKey);
    if (!raw) return this.createNewSession();

    try {
      const parsed = JSON.parse(raw) as Session;
      if (!parsed?.id) return this.createNewSession();

      this.session = parsed;
      this.sessionStartMs = new Date(parsed.createdAt).getTime();

      const meta = this.readMeta();
      if (meta.sessionId !== parsed.id) {
        return this.createNewSession();
      }

      this.ensureCurrentPage(location.pathname);
      this.saveSession();
      return parsed;
    } catch {
      return this.createNewSession();
    }
  }

  saveSession(): void {
    if (!this.session) return;
    localStorage.setItem(this.storageKey, JSON.stringify(this.session));
  }

  restartSession(): Session {
    this.disabled = false;
    localStorage.removeItem(this.storageKey);
    localStorage.removeItem(this.metaKey);
    return this.createNewSession();
  }

  /* =====================
     Auto flush
  ===================== */

  startAutoFlush(): void {
    if (this.disabled) return;

    this.loadSession();
    this.resetInactivityTimer();

    window.addEventListener('beforeunload', this.handlePageHide, { capture: true });
    document.addEventListener('visibilitychange', this.handleVisibility, { capture: true });
    window.addEventListener('storage', this.handleStorageEvent);
  }

  stopAutoFlush(): void {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }

    window.removeEventListener('beforeunload', this.handlePageHide, { capture: true } as any);
    document.removeEventListener('visibilitychange', this.handleVisibility, { capture: true } as any);
    window.removeEventListener('storage', this.handleStorageEvent);
  }

  /* =====================
     Page handling
  ===================== */

  onPageChange(newPage: string): void {
    const now = Date.now();
    const meta = this.readMeta();

    if (meta.currentPage) {
      const duration = Math.max(0, now - meta.pageStart);
      this.addDuration(meta.currentPage, duration);
      this.pushPageHistory(meta.currentPage, newPage, meta.pageStart, duration);
      this.addEvent('page_exit', {
        page: meta.currentPage,
        duration,
      });
    }

    this.ensureCurrentPage(newPage);

    this.writeMeta({
      sessionId: this.requireSession().id,
      currentPage: newPage,
      pageStart: now,
      lastActivity: now,
      finalized: false,
    });

    this.addEvent('page_view', { page: newPage });
    this.saveSession();
  }

  /* =====================
     Events
  ===================== */

  addEvent(type: string, data: EventData = {}): void {
    const sess = this.requireSession();
    const meta = this.readMeta();
    const now = Date.now();

    const page = meta.currentPage || location.pathname;
    this.ensureCurrentPage(page);

    const relative = Math.max(0, now - this.sessionStartMs);
    const event: RecordedEvent = {
      type,
      data,
      timestamp: now,
      relativeTime: relative,
      page,
    };

    const p = this.getPage(page);
    p.events.push(event as PtEvent);
    sess.systemEvents.push(event);

    if (type === 'click') {
      p.totalClicks++;
      sess.totalClicks!++;
    }

    if (type === 'input') {
      p.totalInputs++;
      sess.totalInputs!++;
    }

    this.writeMeta({ ...meta, lastActivity: now });
    this.saveSession();
    this.resetInactivityTimer();
  }

  updateScrollPercentage(percent: number): void {
    const p = this.getPage(this.readMeta().currentPage || location.pathname);
    const value = Math.max(0, Math.min(100, percent));
    if (value > p.percentageScroll) {
      p.percentageScroll = value;
      this.saveSession();
    }
  }

  /* =====================
     Flush
  ===================== */

  async flushNow(reason: FlushReason = 'manual'): Promise<boolean> {
    if (this.disabled || !this.session || this.isSending) return false;

    this.isSending = true;
    try {
      const payload = {
        business_id: this.options.businessId,
        ...this.session,
        _reason: reason,
      };
      return await this.sendPayload(payload);
    } finally {
      this.isSending = false;
    }
  }

  private async sendPayload(data: any): Promise<boolean> {
    if (this.options.useBeacon && navigator.sendBeacon) {
      try {
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        if (navigator.sendBeacon(this.endpoint, blob)) return true;
      } catch {}
    }

    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: this.options.credentials,
        body: JSON.stringify(data),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /* =====================
     Internals
  ===================== */

  private ensureCurrentPage(page: string): void {
    const sess = this.requireSession();
    let p = sess.pages.find(x => x.page === page);
    if (!p) {
      sess.pages.push({
        page,
        duration: 0,
        totalClicks: 0,
        totalInputs: 0,
        percentageScroll: 0,
        events: [],
      });
      sess.totalPagesVisited!++;
    }
    sess.exitPage = page;
  }

  private addDuration(page: string, deltaMs: number): void {
    const p = this.getPage(page);
    p.duration += deltaMs;
  }

  private getPage(page: string): PageSession {
    const sess = this.requireSession();
    let p = sess.pages.find(x => x.page === page);
    if (!p) {
      p = {
        page,
        duration: 0,
        totalClicks: 0,
        totalInputs: 0,
        percentageScroll: 0,
        events: [],
      };
      sess.pages.push(p);
      sess.totalPagesVisited!++;
    }
    return p;
  }

  private pushPageHistory(
    page: string,
    nextPage: string | null,
    timestamp: number,
    duration: number = 0
  ): void {
    const sess = this.requireSession();
    sess.pageHistory.push({
      page,
      previousPage: undefined,
      timestamp,
      duration,
    });
  }

  private resetInactivityTimer(): void {
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    if (this.options.inactivityMs > 0) {
      this.inactivityTimer = window.setTimeout(() => {
        this.flushNow('inactivity');
      }, this.options.inactivityMs);
    }
  }

  private readMeta(): MetaState {
    const raw = localStorage.getItem(this.metaKey);
    if (!raw) {
      const now = Date.now();
      const meta: MetaState = {
        sessionId: this.requireSession().id,
        currentPage: location.pathname,
        pageStart: now,
        lastActivity: now,
        finalized: false,
      };
      this.writeMeta(meta);
      return meta;
    }
    return JSON.parse(raw);
  }

  private writeMeta(meta: MetaState): void {
    localStorage.setItem(this.metaKey, JSON.stringify(meta));
  }

  private requireSession(): Session {
    if (this.disabled) throw new Error('Session tracking disabled');
    if (!this.session) this.loadSession();
    return this.session!;
  }

  private handlePageHide = () => {
    try {
      this.flushNow('pagehide');
    } catch {}
  };

  private handleVisibility = () => {
    if (document.visibilityState === 'hidden') {
      try {
        this.flushNow('visibility');
      } catch {}
    }
  };

  private handleStorageEvent = (e: StorageEvent) => {
    if (e.key !== this.storageKey || !e.newValue) return;
    try {
      const incoming = JSON.parse(e.newValue) as Session;
      if (incoming?.id) this.session = incoming;
    } catch {}
  };

  private getUser(): string | null {
    return localStorage.getItem('tracker_user');
  }
}

export default SessionStorageService;
