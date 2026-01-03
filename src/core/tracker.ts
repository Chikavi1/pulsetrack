// src/SystemTracker.ts
import FingerprintJS from '@fingerprintjs/fingerprintjs';
import { EventData, RecordedEvent, TrackedError, Session } from './interfaces';
import { botTracker } from './bot';
import SessionStorageService from './SessionStorageService';

import { RRWebOrchestrator } from './rrweb/rrweborchestrator';
import { sendToBackend } from './rrweb/rrwebsender';
import { RRWebTracker } from './rrweb/rrwebtracker';

export interface TrackerOptions {
  businessId?: string;
}

export class SystemTracker {
  private readonly endpoint: string;
  private readonly options: TrackerOptions;

  // ⚠️ Session solo para errores y API pública
  // private session: Session;

  private pageUrl: string = window.location.pathname;
  private maxScroll = 0;
  private lastEventHash: string | null = null;

  private botTracker: botTracker = new botTracker();
  // private sessionStartTime: number;
  private errors: TrackedError[] = [];
  private isPaused = false;

  // private storage: SessionStorageService;


   private rrwebTracker: RRWebTracker;
   private rrwebOrchestrator: RRWebOrchestrator;

  constructor(options: TrackerOptions = {}) {
    this.options = { ...options };
    this.endpoint = 'http://localhost:3001/sessions';


    this.rrwebTracker = new RRWebTracker();

    this.rrwebOrchestrator = new RRWebOrchestrator(
      this.rrwebTracker,
      (chunk) => {
        return sendToBackend({
          ...chunk,
          businessId: this.options.businessId,
        });
      }
    );



    // ✅ SINGLE SOURCE OF TRUTH
    // this.storage = new SessionStorageService({
    //   businessId: options.businessId,
    //   inactivityMs: 30000,
    //   useBeacon: true,
    // });

    // // 🔑 IMPORTANTE: cargar sesión SIEMPRE
    // this.storage.startAutoFlush();

    // this.sessionStartTime = Date.now();
    // this.session = this.createSession();

    // this.trackErrors();

    // // ✅ SOLO SPA maneja navegación manual
    // if (this.isSPA()) {
    //   this.setupNavigationListener();
    // }

    // (async () => {
    //   await this.injectFingerprintOnce();
    //   await this.botTracker.initBotDetection();
    // })();
  }

  /* =====================
     Utils
  ===================== */

  private isSPA(): boolean {
    return (
      !!(window.history && history.pushState) &&
      !!document.querySelector('#app, #root, [data-router], body[data-spa]')
    );
  }

  /* =====================
     Public API
  ===================== */

  public track(type: string, payload?: any): void {
    if (this.isPaused) return;
    this.recordEvent(type, payload);
  }

  public init(): void {
    this.startTracking();
  }

  public start(): void {
   this.rrwebOrchestrator.start();
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
    this.rrwebOrchestrator.stop();
    // await this.storage.flushNow('manual');
  }

  public clear(): void {
    // this.storage.restartSession();
  }

  public reset(): void {
    // this.session = this.createSession();
    this.pageUrl = window.location.pathname;
    this.maxScroll = 0;
    this.lastEventHash = null;
    // this.sessionStartTime = Date.now();
    this.errors = [];
    this.isPaused = false;
  }

  public getData(): Session | null {
    const data = localStorage.getItem('pt:session:v1');
    if (!data) return null;
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  public getEvents(): RecordedEvent[] {
    // return this.session.systemEvents;
    return [];
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
        relativeTime: now,
        //  now - (this.sessionStartTime || now),
      page: this.pageUrl,
    };

    const hash = JSON.stringify(event);
    if (this.lastEventHash === hash) return;
    this.lastEventHash = hash;

    // this.storage.addEvent(type, data);
  }

  /* =====================
     Navigation (SPA ONLY)
  ===================== */

  private handlePageChange(newPage: string): void {
    if (newPage === this.pageUrl) return;

    this.maxScroll = 0;
    this.lastEventHash = null;
    this.pageUrl = newPage;

    // this.storage.onPageChange(newPage);
  }

  private setupNavigationListener(): void {
    if ((window as any).__ptHistoryPatched) return;
    (window as any).__ptHistoryPatched = true;

    const handler = () => {
      this.handlePageChange(window.location.pathname);
    };

    window.addEventListener('popstate', handler);

    const originalPush = history.pushState;
    history.pushState = (...args) => {
      originalPush.apply(history, args);
      handler();
    };
  }

  /* =====================
     Listeners
  ===================== */

  private startTracking(): void {
    this.listenClicks();
    this.listenInputs();
    this.listenScroll();
  }

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
    const timeouts = new WeakMap<Element, number>();

    document.body.addEventListener('input', (e: any) => {
      const target = e.target as HTMLInputElement | HTMLTextAreaElement;
      if (!target || !['INPUT', 'TEXTAREA'].includes(target.tagName)) return;

      const prev = timeouts.get(target);
      if (prev) clearTimeout(prev);

      const id = window.setTimeout(() => {
        if (!target.value) return;

        this.recordEvent('input', {
          tag: target.tagName,
          name: target.name || target.id || null,
          value: target.value.slice(0, 50),
          length: target.value.length,
        });
      }, 500);

      timeouts.set(target, id);
    });
  }

  private listenScroll(): void {
    window.addEventListener('scroll', () => {
      const total = document.documentElement.scrollHeight - window.innerHeight;
      if (total <= 0) return;

      const percent = Math.round((window.scrollY / total) * 100);
      if (percent > this.maxScroll) {
        this.maxScroll = percent;
        // this.storage.updateScrollPercentage(percent);
      }
    });
  }

  /* =====================
     Fingerprint
  ===================== */

  private async injectFingerprintOnce(): Promise<void> {
    const data = this.getData();
    if (data?.userInfo?.fingerprint) return;

    try {
      const fp = await FingerprintJS.load();
      const result = await fp.get();
        // this.storage.setFingerprint(result.visitorId);
    } catch {
      // this.storage.setFingerprint(null);
    }
  }

  /* =====================
     Errors
  ===================== */

  private trackErrors(): void {
    const record = (err: TrackedError, type: string) => {
      err.hash = this.generateErrorHash(err);

      const existing = this.errors.find(e => e.hash === err.hash);
      if (existing) {
        existing.count = (existing.count || 1) + 1;
        existing.lastOccurred = Date.now();
        return;
      }

      err.count = 1;
      err.lastOccurred = Date.now();
      this.errors.push(err);

      // this.storage.addEvent(type, err);
    };

    window.addEventListener('error', e => {
      record({
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

    window.addEventListener('unhandledrejection', e => {
      record({
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
     Session
  ===================== */

  private generateSession() {
    return `sess_${Date.now()}`;
  }

  private createSession(): Session {
    const page = window.location.pathname;
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
        page,
        timestamp: now,
        previousPage: undefined,
        duration: 0,
      }],
      entryPage: page,
      exitPage: page,
      systemEvents: [],
      totalClicks: 0,
      totalInputs: 0,
      totalPagesVisited: 1,
      rrwebEvents: [],
    };
  }

  private getUser() {
    return localStorage.getItem('tracker_user');
  }
}
