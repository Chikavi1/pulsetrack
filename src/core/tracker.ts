// src/SystemTracker.ts
import FingerprintJS from '@fingerprintjs/fingerprintjs';
import { Event, EventData, RecordedEvent, TrackedError, Session } from './interfaces';
import { botTracker } from './bot';
import SessionStorageService from './SessionStorageService';

export interface TrackerOptions {
  businessId?: string;
  userId?: string;
}

export class SystemTracker {
  private readonly endpoint: string;
  private readonly options: TrackerOptions;
  private session: Session;
  private pageUrl: string = window.location.pathname;
  private maxScroll: number = 0;
  private lastEventHash: string | null = null;
  private fingerprint: string | null = null;
  private botTracker: botTracker = new botTracker();
  private sessionStartTime: number;
  private pageStartTime: number;
  private errors: TrackedError[] = [];
  private isPaused: boolean = false;
  private storage: SessionStorageService;

  constructor(options: TrackerOptions = {}) {
    this.options = { ...options };
    this.endpoint = 'http://localhost:3001/sessions';

    // ✅ Storage (single source of truth)
    this.storage = new SessionStorageService({
      businessId: options.businessId,
      inactivityMs: 30000,
      useBeacon: true,
    });
    this.storage.startAutoFlush();

    this.sessionStartTime = Date.now();
    this.pageStartTime = this.sessionStartTime;

    // ⚠️ Session se mantiene SOLO para errores y payload final
    this.session = this.createSession();

    this.trackErrors();
    this.setupNavigationListener();

    (async () => {
      await this.loadFingerprint();
      await this.botTracker.initBotDetection();
    })();
  }

  /* =====================
     Public API
  ===================== */

  public track(type: string, payload?: any): void {
    if (this.isPaused) return;
    this.recordEvent(type, payload);
  }

  public startTracking(): void {
    this.listenClicks();
    this.listenInputs();
    this.listenScroll();
    this.listenInternalLinks();
  }

  public init(): void {
    this.startTracking();
  }

  public start(): void {
    this.startTracking();
  }

  public pause(): void {
    this.isPaused = true;
    this.recordEvent('session_pause');
  }

  public resume(): void {
    if (!this.isPaused) return;
    this.isPaused = false;
    this.recordEvent('session_resume');
  }

  public async stop(): Promise<void> {
    await this.storage.flushNow('manual');
    await this.endSession();
  }

  public clear(): void {
    this.storage.restartSession();
  }

  public reset(): void {
    this.session = this.createSession();
    this.pageUrl = window.location.pathname;
    this.maxScroll = 0;
    this.lastEventHash = null;
    this.sessionStartTime = Date.now();
    this.pageStartTime = this.sessionStartTime;
    this.errors = [];
    this.isPaused = false;
  }

  public getData(): Session | null {
    const data = localStorage.getItem('pt:session:v1');
    if (!data) return null;

    try {
      return JSON.parse(data);
    } catch (error) {
      console.error('Failed to parse session data:', error);
      return null;
    }
  }

  public getEvents(): RecordedEvent[] {
    return this.session.systemEvents;
  }

  public getErrors(): TrackedError[] {
    return this.errors;
  }

  /* =====================
     Event recording
  ===================== */

  private recordEvent(type: string, data: EventData = {}): void {
    if (this.isPaused) return;

    const now = Date.now();
    const event: RecordedEvent = {
      type,
      data,
      timestamp: now,
      relativeTime: now - this.sessionStartTime,
      page: this.pageUrl,
    };

    const hash = JSON.stringify(event);
    if (this.lastEventHash === hash) return;
    this.lastEventHash = hash;

    // ⚠️ SystemTracker NO modifica contadores ni páginas
    // ⚠️ Solo emite el evento
    this.session.systemEvents.push(event);

    // ✅ Persistencia centralizada
    this.storage.addEvent(type, data);
  }

  /* =====================
     Page management
  ===================== */

  private generateSession() {
    return `sess_${Date.now()}`;
  }

  private createSession(): Session {
    const initialPage = window.location.pathname;
    const now = Date.now();

    return {
      id: this.generateSession(),
      createdAt: new Date().toISOString(),
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
      pages: [],
      pageHistory: [{
        page: initialPage,
        timestamp: now,
        previousPage: undefined,
        duration: 0
      }],
      entryPage: initialPage,
      exitPage: initialPage,
      systemEvents: [],
      totalClicks: 0,
      totalInputs: 0,
      totalPagesVisited: 1,
      rrwebEvents: [],
    };
  }

  private handlePageChange(newPage: string): void {
    const now = Date.now();
    const oldPage = this.pageUrl;

    if (newPage === oldPage) return;

    const pageDuration = now - this.pageStartTime;

    this.recordEvent('page_exit', {
      page: oldPage,
      duration: pageDuration,
      maxScroll: this.maxScroll,
    });

    this.maxScroll = 0;
    this.lastEventHash = null;
    this.pageUrl = newPage;
    this.pageStartTime = now;

    this.session.exitPage = newPage;

    this.session.pageHistory.push({
      page: newPage,
      timestamp: now,
      previousPage: oldPage,
      duration: 0
    });

    const uniquePages = new Set(this.session.pageHistory.map(p => p.page));
    this.session.totalPagesVisited = uniquePages.size;

    // ✅ Importante: storage decide la página actual
    this.storage.onPageChange(newPage);

    this.recordEvent('page_view', {
      page: newPage,
      previousPage: oldPage,
    });
  }

  /* =====================
     Listeners
  ===================== */

  private listenClicks(): void {
    document.body.addEventListener('click', (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target) return;

      this.recordEvent('click', {
        x: e.clientX,
        y: e.clientY,
        target: target.tagName,
        text: target.innerText || (target as any).value,
      });
    });
  }

  private listenInputs(): void {
    const inputTimeouts = new WeakMap<Element, number>();

    document.body.addEventListener('input', (e: any) => {
      const target = e.target as HTMLInputElement | HTMLTextAreaElement;
      if (!target || !['INPUT', 'TEXTAREA'].includes(target.tagName)) return;

      const prevTimeout = inputTimeouts.get(target);
      if (prevTimeout) clearTimeout(prevTimeout);

      const timeoutId = window.setTimeout(() => {
        if (!target.value) return;

        this.recordEvent('input', {
          tag: target.tagName,
          name: target.name || target.id || null,
          value: target.value.slice(0, 50),
          length: target.value.length,
        });
      }, 500);

      inputTimeouts.set(target, timeoutId);
    });
  }

  private listenScroll(): void {
    window.addEventListener('scroll', () => {
      const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollHeight <= 0) return;

      const percent = Math.round((window.scrollY / scrollHeight) * 100);
      if (percent > this.maxScroll) {
        this.maxScroll = percent;

        // ⚠️ No tocar session.pages aquí
        this.storage.updateScrollPercentage(percent);
      }
    });
  }

  private setupNavigationListener(): void {
    if ((window as any).__ptHistoryPatched) return;
    (window as any).__ptHistoryPatched = true;

    const handleNavigation = () => {
      const newUrl = window.location.pathname;
      this.handlePageChange(newUrl);
    };

    window.addEventListener('popstate', handleNavigation);

    const pushState = history.pushState;
    history.pushState = (...args) => {
      pushState.apply(history, args);
      handleNavigation();
    };
  }

  private listenInternalLinks(): void {
  document.body.addEventListener('click', (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target) return;

    const link = target.closest('a[href]');
    if (!link) return;

    const href = link.getAttribute('href');
    if (!href) return;
    if (href.startsWith('http') || href.startsWith('//')) return; // links externos ignorados

    // Llama a tu método interno de cambio de página
    this.handlePageChange(href);
  });
}

  /* =====================
     Fingerprint & Bot
  ===================== */

  public async getFingerprint(): Promise<string | null> {
    const fp = await FingerprintJS.load();
    const result = await fp.get();
    return result.visitorId;
  }

  private async loadFingerprint(): Promise<void> {
    try {
      this.fingerprint = await this.getFingerprint();
      this.session.userInfo.fingerprint = this.fingerprint;
    } catch {
      this.fingerprint = null;
      this.session.userInfo.fingerprint = null;
    }
  }

  /* =====================
     Error tracking
  ===================== */

  private trackErrors(): void {
    const recordError = (err: TrackedError, type: string) => {
      err.hash = this.generateErrorHash(err);

      const exists = this.errors.find(e => e.hash === err.hash);
      if (exists) {
        exists.count = (exists.count || 1) + 1;
        exists.lastOccurred = Date.now();
        return;
      }

      err.count = 1;
      err.lastOccurred = Date.now();
      this.errors.push(err);
      this.session.errors.push(err);

      this.recordEvent(type, err);
    };

    window.addEventListener('error', (e: ErrorEvent) => {
      recordError({
        message: e.message,
        stack: e.error?.stack,
        source: e.filename,
        lineno: e.lineno,
        colno: e.colno,
        timestamp: Date.now(),
        page: this.pageUrl,
        hash: '',
        lastOccurred: Date.now(),
      }, 'error');
    });

    window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
      recordError({
        message: String(e.reason),
        stack: e.reason?.stack,
        timestamp: Date.now(),
        page: this.pageUrl,
        hash: '',
        lastOccurred: Date.now(),
      }, 'unhandled_rejection');
    });
  }

  private generateErrorHash(err: TrackedError): string {
    const str = `${err.message}|${err.stack ?? ''}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString();
  }

  /* =====================
     Session & Payload
  ===================== */

  private async endSession(): Promise<void> {
    const payload = JSON.stringify(this.getPayload());
    await this.sendPayload(payload);
  }

  private async sendPayload(payload: string): Promise<void> {
    if (navigator.sendBeacon) {
      try {
        const blob = new Blob([payload], { type: 'application/json' });
        if (navigator.sendBeacon(this.endpoint, blob)) return;
      } catch {}
    }

    await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      credentials: 'include',
    });
  }

  private getUser() {
    return localStorage.getItem('tracker_user') || null;
  }

  private getPayload(): any {
    const now = Date.now();
    const sessionDuration = now - this.sessionStartTime;

    this.session.exitPage = this.pageUrl;
    this.recordEvent('session_end', {
      duration: sessionDuration,
      maxScroll: this.maxScroll,
    });

    return {
      business_id: this.options.businessId,
      ...this.session,
    };
  }
}
