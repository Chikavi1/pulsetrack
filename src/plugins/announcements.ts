import { getConfig } from '../core/config';
import { SystemTracker } from '../core/tracker';

export type AnnouncementType = 'info' | 'success' | 'warning' | 'error';

export interface AnnouncementConfig {
  tracker: SystemTracker;
  message?: string;
  title?: string;
  linkUrl?: string;
  linkText?: string;
  type?: AnnouncementType;
  themeColor?: string;
  autoShow?: boolean;
  duration?: number;
  dismissible?: boolean;
  pushBody?: boolean;
}

export class Announcement {
  tracker: SystemTracker;
  config: Required<Omit<AnnouncementConfig, 'tracker'>> & {
    tracker: SystemTracker;
  };

  container!: HTMLDivElement;
  isVisible = false;
  closeTimeout?: number;
  originalBodyPaddingTop = '';

  constructor(config: AnnouncementConfig) {
    if (!config.tracker) throw new Error('Announcement requires tracker');

    this.tracker = config.tracker;

    this.config = {
      type: 'info',
      themeColor: '#3b82f6',
      autoShow: true,
      duration: 0,
      dismissible: true,
      pushBody: true,
      title: '',
      message: '',
      linkUrl: 'https://rojastudio.xyz',
      linkText: 'Más información',
      ...config,
    };

    this.init();
  }

  /* ---------------- INIT ---------------- */

  private async init() {
    this.addStyles();

    // 🔥 Igual que Feedback: primero intenta remoto
    this.applyRemoteConfig();

    // Si no hay mensaje, no renderiza nada
    if (!this.config.message) return;

    this.createAnnouncement();

    if (this.config.autoShow) {
      setTimeout(() => this.show(), 50);
    }
  }

  private applyRemoteConfig() {
 
 

    this.config.message = this.config.message;
    this.config.title = this.config.title;
    this.config.linkUrl = this.config.linkUrl;
    this.config.linkText = this.config.linkText;

    this.config.type = this.config.type;
 
    this.config.duration =
      this.config.duration ?? 0;

    this.config.dismissible =
      this.config.dismissible ?? true;

    this.config.pushBody =
      this.config.pushBody ?? true;
  }

  /* ---------------- DOM ---------------- */

  private createAnnouncement() {
    if (document.getElementById('pt-announcement-bar')) {
      this.container = document.getElementById(
        'pt-announcement-bar'
      ) as HTMLDivElement;
      return;
    }

    this.container = document.createElement('div');
    this.container.id = 'pt-announcement-bar';
    this.container.className = `pt-announcement pt-${this.config.type}`;
    this.container.style.background = this.getTypeColor();

    this.container.innerHTML = `
      <div class="pt-announcement-inner">
        <div class="pt-announcement-text">
          ${this.config.title ? `<strong>${this.config.title}</strong>` : ''}
          <span>${this.config.message}</span>
          ${
            this.config.linkUrl
              ? `<a href="${this.config.linkUrl}" target="_blank">${this.config.linkText}</a>`
              : ''
          }
        </div>

        ${
          this.config.dismissible
            ? `<button class="pt-announcement-close">&times;</button>`
            : ''
        }
      </div>
    `;

    document.body.prepend(this.container);

    if (this.config.dismissible) {
      const closeBtn = this.container.querySelector(
        '.pt-announcement-close'
      ) as HTMLButtonElement;

      closeBtn?.addEventListener('click', () => this.hide());
    }
  }

  /* ---------------- VISIBILITY ---------------- */

  show() {
    if (!this.container || this.isVisible) return;

    this.isVisible = true;

    if (this.config.pushBody) {
      this.pushBodyDown();
    }

    this.container.classList.add('visible');

    if (this.config.duration && this.config.duration > 0) {
      this.closeTimeout = window.setTimeout(
        () => this.hide(),
        this.config.duration
      );
    }
  }

  hide() {
    if (!this.container || !this.isVisible) return;

    this.isVisible = false;
    this.container.classList.remove('visible');

    if (this.config.pushBody) {
      this.restoreBody();
    }

    if (this.closeTimeout) {
      clearTimeout(this.closeTimeout);
    }
  }

  /* ---------------- BODY PUSH ---------------- */

  private pushBodyDown() {
    const height = this.container.offsetHeight;

    this.originalBodyPaddingTop = document.body.style.paddingTop || '';

    const currentPadding =
      parseInt(getComputedStyle(document.body).paddingTop || '0', 10) || 0;

    document.body.style.paddingTop = `${currentPadding + height}px`;
  }

  private restoreBody() {
    document.body.style.paddingTop = this.originalBodyPaddingTop;
  }

  /* ---------------- STYLES ---------------- */

  private addStyles() {
    if (document.getElementById('pt-announcement-styles')) return;

    const style = document.createElement('style');
    style.id = 'pt-announcement-styles';
    style.textContent = `
      .pt-announcement {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 999999;
        transform: translateY(-100%);
        transition: transform 0.3s ease;
        color: #fff;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }

      .pt-announcement.visible {
        transform: translateY(0);
      }

      .pt-announcement-inner {
        max-width: 1200px;
        margin: 0 auto;
        padding: 12px 24px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .pt-announcement-text {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        font-size: 14px;
      }

      .pt-announcement a {
        color: #fff;
        text-decoration: underline;
        font-weight: 500;
      }

      .pt-announcement-close {
        background: none;
        border: none;
        color: #fff;
        font-size: 20px;
        cursor: pointer;
        opacity: 0.7;
      }

      .pt-announcement-close:hover {
        opacity: 1;
      }

      @media (max-width: 640px) {
        .pt-announcement-inner {
          flex-direction: column;
          text-align: center;
        }
      }
    `;

    document.head.appendChild(style);
  }

  /* ---------------- HELPERS ---------------- */

  private getTypeColor() {
    switch (this.config.type) {
      case 'success':
        return '#22c55e';
      case 'warning':
        return '#f59e0b';
      case 'error':
        return '#ef4444';
      default:
        return this.config.themeColor;
    }
  }
}
