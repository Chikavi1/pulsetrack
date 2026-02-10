import { getConfig } from '../core/config';
import { SystemTracker } from '../core/tracker';

export type AnnouncementType = 'info' | 'success' | 'warning' | 'error';

export interface AnnouncementConfig {
  tracker: SystemTracker;
  message?: string;
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
    if (!config.tracker) {
      throw new Error('Announcement requires tracker');
    }

    this.tracker = config.tracker;

    this.config = {
      type: 'info',
      themeColor: '#252525ff',
      autoShow: true,
      duration: 0,
      dismissible: true,
      pushBody: false,
      message: '',
      linkUrl: '',
      linkText: '',
      ...config,
      tracker: config.tracker,
    };

    this.init();
  }

  /* ---------------- INIT ---------------- */

  private init() {
    this.addStyles();
    this.applyRemoteConfig();
    console.log('After applyRemoteConfig, message:', this.config.message);
    this.createAnnouncement();

    if (this.config.autoShow && this.config.message) {
      setTimeout(() => this.show(), 50);
    }
  }

  /**
   * Normaliza valores (local + remote)
   * No re-lee this.config como fuente
   */
  private applyRemoteConfig() {
    const data: any = this.config;

    console.log('config remote announcement', data);

    this.config.message = data.message ?? '';
    this.config.linkUrl = data.linkUrl ?? data.link_url ?? '';
    this.config.linkText = data.linkText ?? data.link_text ?? '';
    this.config.type = data.type ?? 'info';
    this.config.duration = data.duration ?? 0;
    this.config.dismissible = data.dismissible ?? true;
    this.config.pushBody = data.pushBody ?? false;
  }

  /* ---------------- DOM ---------------- */

  private createAnnouncement() {
    const existing = document.getElementById('pt-announcement-bar');

    if (existing) {
      this.container = existing as HTMLDivElement;
      this.updateAnnouncement();
      return;
    }

    this.container = document.createElement('div');
    this.container.id = 'pt-announcement-bar';
    this.container.className = `pt-announcement pt-${this.config.type}`;
    this.container.style.background = this.getTypeColor();

    this.container.innerHTML = this.getTemplate();

    document.body.prepend(this.container);

    if (this.config.dismissible) {
      const closeBtn = this.container.querySelector(
        '.pt-announcement-close'
      ) as HTMLButtonElement;
      console.log('Close button found in create:', !!closeBtn);
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          console.log('Close button clicked in create');
          e.preventDefault();
          this.hide();
        });
      }
    }
  }

  private updateAnnouncement() {
    this.container.className = `pt-announcement pt-${this.config.type}`;
    this.container.style.background = this.getTypeColor();
    this.container.innerHTML = this.getTemplate();
    
    // Re-add event listeners after updating innerHTML
    if (this.config.dismissible) {
      const closeBtn = this.container.querySelector('.pt-announcement-close') as HTMLButtonElement;
      console.log('Close button found:', !!closeBtn);
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          console.log('Close button clicked');
          e.preventDefault();
          this.hide();
        });
      }
    }
  }

  private getTemplate() {
    const template = `
      <div class="pt-announcement-inner">
        <div class="pt-announcement-text">
          ${
            this.config.message
              ? `<strong>${this.config.message}</strong>`
              : '<strong>NO MESSAGE</strong>'
          }
          ${
            this.config.linkUrl
              ? `<a href="${this.config.linkUrl}" target="_blank" rel="noopener">${this.config.linkText}</a>`
              : ''
          }
        </div>
        ${
          this.config.dismissible
            ? `<button type="button" class="pt-announcement-close" aria-label="Close">&times;</button>`
            : ''
        }
      </div>
    `;
    console.log('Generated template:', template);
    return template;
  }

  /* ---------------- VISIBILITY ---------------- */

  show() {
    console.log('Show called, message:', this.config.message, 'container exists:', !!this.container);
    if (!this.container || this.isVisible) return;
  
    this.isVisible = true;
    console.log('Adding visible class and forcing styles');
    
    // Force positioning and visibility
    this.container.style.position = 'fixed';
    this.container.style.top = '0';
    this.container.style.left = '0';
    this.container.style.right = '0';
    this.container.style.width = '100%';
    this.container.style.zIndex = '2147483647';
    this.container.style.display = 'block';
    this.container.style.transform = 'none';
    this.container.style.margin = '0';
    this.container.classList.add('visible');
  
    if (this.config.pushBody) {
      this.pushBodyDown();
    }
  
    if (this.config.duration && this.config.duration > 0) {
      this.closeTimeout = window.setTimeout(() => this.hide(), this.config.duration);
    }
  }

private pushBodyDown() {
  // Asegúrate de que el contenedor no esté oculto para medirlo
  const height = this.container.getBoundingClientRect().height; 
  if (height === 0) return; // Si sigue siendo 0, no empujamos el body

  this.originalBodyPaddingTop = document.body.style.paddingTop || '';
  const currentPadding = parseInt(window.getComputedStyle(document.body).paddingTop || '0', 10);
  document.body.style.paddingTop = `${currentPadding + height}px`;
}

  hide() {
    if (!this.container || !this.isVisible) return;

    this.isVisible = false;
    console.log('Hiding announcement');
    this.container.classList.remove('visible');
    this.container.style.display = 'none'; // Force hide

    if (this.config.pushBody) {
      this.restoreBody();
    }

    if (this.closeTimeout) {
      clearTimeout(this.closeTimeout);
      this.closeTimeout = undefined;
    }
  }

  /* ---------------- BODY PUSH ---------------- */

 

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
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        width: 100% !important;
        margin: 0 !important;
        z-index: 2147483647 !important;
        color: #fff;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        display: none;
      }

      .pt-announcement.visible {
        display: block;
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
