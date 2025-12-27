// src/SystemTracker.ts
import FingerprintJS from '@fingerprintjs/fingerprintjs';
import { Event, EventData, RecordedEvent, TrackedError, Session } from './interfaces';
import { botTracker } from './bot';
 
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

  constructor(options: TrackerOptions = {}) {
    this.options = { ...options };
    this.endpoint = 'http://localhost:3001/sessions';

    this.sessionStartTime = Date.now();
    this.pageStartTime = this.sessionStartTime;

    this.session = this.createSession();
    this.addPageIfNotExist();
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
    await this.endSession();
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

  public getData(): Session {
    console.log('session',this.getPayload());
    return this.session;
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
  
    const page = this.getCurrentPage();
    page.events.push({ ...event, page: this.pageUrl });
  
    console.log('Evento creado')
  
     if (type === 'input') {
      console.log('Input creado')
      page.totalInputs ??= 0;
      page.totalInputs++;
      this.session.totalInputs!++;
    }
  
  
    if (type === 'click') {
    const target = data.target as HTMLElement | undefined;
  
     if (target && target.tagName === 'INPUT') {
      const inputType = (target as HTMLInputElement).type;
      if (inputType === 'text' || inputType === 'number' || inputType === 'password') {
        return;  
      }
    }
  
    console.log('Click creado');
    page.totalClicks++;
    this.session.totalClicks!++;
  }
    
   
    this.session.systemEvents.push(event);
  }
  

  /* =====================
     Page management
  ===================== */


  private generateSession(){
    return `sess_${Date.now()}`;
  }

  private createSession(): Session {
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
      pages: [{
        page: window.location.pathname,
        duration: 0,
        totalClicks: 0,
        totalInputs: 0,
        percentageScroll: 0,
        events: [],
      }],
      entryPage: window.location.pathname,
      exitPage: window.location.pathname,
      systemEvents:[],
      totalClicks: 0,
      totalInputs: 0,
      totalPagesVisited: 1,
      rrwebEvents:[]
    };
  }

  private addPageIfNotExist(): void {
    const exists = this.session.pages.find(p => p.page === this.pageUrl);
    if (!exists) {
      this.session.pages.push({
        page: this.pageUrl,
        duration: 0,
        totalClicks: 0,
        totalInputs: 0,
        percentageScroll: 0,
        events: [],
      });
    }
  }

  private getCurrentPage() {
    return this.session.pages.find(p => p.page === this.pageUrl)!;
  }

  private handlePageChange(newPage: string): void {
    const now = Date.now();
    const currentPage = this.getCurrentPage();
    if (currentPage) {
      currentPage.duration = now - this.pageStartTime;
      this.recordEvent('page_exit', { page: this.pageUrl, duration: currentPage.duration, maxScroll: this.maxScroll });
    }

    this.maxScroll = 0;
    this.lastEventHash = null;
    const oldPage = this.pageUrl;
    this.pageUrl = newPage;
    this.pageStartTime = now;

    this.addPageIfNotExist();
    this.session.exitPage = newPage;
    this.recordEvent('page_view', { page: newPage, previousPage: oldPage });
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
        this.getCurrentPage().percentageScroll = percent;
      }
    });
  }

  private setupNavigationListener(): void {
    if ((window as any).__ptHistoryPatched) return;
    (window as any).__ptHistoryPatched = true;

    const handleNavigation = () => {
      const newUrl = window.location.pathname;
      if (newUrl === this.pageUrl) return;
      this.handlePageChange(newUrl);
    };

    window.addEventListener('popstate', handleNavigation);

    const pushState = history.pushState;
    const replaceState = history.replaceState;

    history.pushState = (...args) => {
      pushState.apply(history, args);
      handleNavigation();
    };

    history.replaceState = (...args) => {
      replaceState.apply(history, args);
      handleNavigation();
    };
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
      } else {
        err.count = 1;
        err.lastOccurred = Date.now();
        this.errors.push(err);
        this.session.errors.push(err);
        this.recordEvent(type, err);
      }
    };

    window.addEventListener('error', (e: ErrorEvent) => {
      const error: TrackedError = {
        message: e.message,
        stack: e.error?.stack,
        source: e.filename,
        lineno: e.lineno,
        colno: e.colno,
        timestamp: Date.now(),
        page: this.pageUrl,
        hash: '',
        lastOccurred: Date.now(),
      };
      recordError(error, 'error');
    });

    window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
      const error: TrackedError = {
        message: String(e.reason),
        stack: e.reason?.stack,
        timestamp: Date.now(),
        page: this.pageUrl,
        hash: '',
        lastOccurred: Date.now(),
      };
      recordError(error, 'unhandled_rejection');
    });

    const originalConsoleError = console.error;
    console.error = (...args: any[]) => {
      const error: TrackedError = {
        message: args.map(a => String(a)).join(' '),
        timestamp: Date.now(),
        page: this.pageUrl,
        hash: '',
        lastOccurred: Date.now(),
      };
      recordError(error, 'console_error');
      originalConsoleError.apply(console, args);
    };
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

  private async endSession(rrwebEvents: any[] = []): Promise<void> {
    const payload = this.getPayload(rrwebEvents);
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

  private getUser(){
    return localStorage.getItem('tracker_user') || null;
  }

  private getPayload(rrwebEvents: any[] = []): any {
    const now = Date.now();
    const sessionDuration = now - this.sessionStartTime;

    this.session.exitPage = this.pageUrl;
    this.recordEvent('session_end', { duration: sessionDuration, maxScroll: this.maxScroll });

    const data = {
      business_id: this.options.businessId,
      ...this.session
    };

 
    

    return data; 
    // JSON.stringify(data);
  }
}
