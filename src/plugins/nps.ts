import { getConfig } from '../core/config';
import { SystemTracker } from '../core/tracker';
import { SessionStorageService } from '../core/SessionStorageService';

export interface NpsConfig {
  tracker: SystemTracker;
  question?: string;
  minLabel?: string;
  maxLabel?: string;
  themeColor?: string;
  position?: 'bottom-right' | 'bottom-left' | 'bottom-center' | 'top-right' | 'top-left';
  autoShow?: boolean;
  delay?: number;
  mode?: 'manual' | 'remote';
}

export class Nps {
  tracker: SystemTracker;
  config: Required<Omit<NpsConfig, 'tracker'>> & { tracker: SystemTracker };

  private container!: HTMLDivElement;
  private hasVoted = false;

  constructor(config: NpsConfig) {
    if (!config.tracker) throw new Error('NPS requires tracker');

    this.tracker = config.tracker;

    this.config = {
      question: '¿Qué tan probable es que recomiendes este servicio?',
      minLabel: 'Poco probable',
      maxLabel: 'Muy probable',
      themeColor: '#2563eb',
      position: 'bottom-center',
      autoShow: false,
      delay: 2000,
      mode: 'manual',
      ...config,
    };
    this.init();
  }
 
  private init() {
    this.applyRemoteConfig();

    if (this.config.autoShow) {
      setTimeout(() => this.renderWidget(), this.config.delay);
    }
  }
 
  private applyRemoteConfig() {
    if (this.config.mode !== 'remote') return;

    const globalConfig = getConfig();
    // const remoteNps = globalConfig?.remote?.nps;

    // if (!remoteNps?.enabled) return;

    // this.config.question = this.config.question || remoteNps.question;
    // this.config.themeColor = this.config.themeColor || remoteNps.themeColor;
    // this.config.position = this.config.position || remoteNps.position;

    // this.config.autoShow =
    //   this.config.autoShow ?? remoteNps.autoShow ?? false;

    // this.config.delay =
    //   this.config.delay ?? remoteNps.delay ?? 2000;
  }

  private renderWidget() {
    if (document.getElementById('pt-nps-widget')) return;

    this.container = document.createElement('div');
    this.container.id = 'pt-nps-widget';
    this.container.setAttribute('data-html2canvas-ignore', 'true');
    this.container.innerHTML = this.getStep1Template();

    this.applyStyles();
    document.body.appendChild(this.container);

    this.attachStep1Listeners();
  }

  public hideForScreenshot() {
    if (this.container) {
      this.container.style.display = 'none';
    }
  }
  
  public showAfterScreenshot() {
    if (this.container) {
      this.container.style.display = '';
    }
  }
  
  /* ---------------- STEP 1 ---------------- */

  private getStep1Template(): string {
    return `
      <div class="nps-card">
        <button class="nps-close">×</button>
        <h3 class="nps-question">${this.config.question}</h3>
        <div class="nps-options">
          ${Array.from({ length: 10 }, (_, i) =>
            `<button class="nps-btn" data-score="${i + 1}">${i + 1}</button>`
          ).join('')}
        </div>
        <p class="nps-footer">1 = ${this.config.minLabel}, 10 = ${this.config.maxLabel}</p>
        <p class="nps-footer powered">
          Powered by <a href="https://rojastudio.xyz" target="_blank">PulseTrack</a>
        </p>
      </div>
    `;
  }

  private attachStep1Listeners() {
    const buttons = this.container.querySelectorAll('.nps-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', e => {
        const score = parseInt(
          (e.target as HTMLElement).dataset.score!,
          10
        );
        this.renderStep2(score);
      });
    });

    const close = this.container.querySelector('.nps-close');
    close?.addEventListener('click', () => this.close());
  }

  /* ---------------- STEP 2 ---------------- */

  private renderStep2(score: number) {
    let title = '';
    let placeholder = '';
    let askContact = true;

    if (score <= 6) {
      title = 'Lamentamos no haber cumplido tus expectativas 😞<br/>¿Qué podríamos mejorar?';
      placeholder = 'Tu sugerencia...';
    } else if (score <= 8) {
      title = 'Gracias por tu opinión 🙏<br/>¿Qué mejorarías?';
      placeholder = 'Tu comentario...';
    } else {
      title = '¡Gracias por recomendarnos! ❤️<br/>¿Te gustaría dejarnos tu correo?';
      placeholder = 'Tu mensaje...';
    }

    this.container.innerHTML = `
      <div class="nps-card">
        <button class="nps-close">×</button>
        <h3 class="nps-question">${title}</h3>

        ${askContact ? `<input class="nps-input" type="email" placeholder="Tu correo (opcional)" />` : ''}

        <textarea class="nps-text" rows="2" placeholder="${placeholder}" style="resize:none;"></textarea>

        <button class="nps-submit">Enviar</button>
      </div>
    `;

    this.applyStyles();

    this.container
      .querySelector('.nps-submit')
      ?.addEventListener('click', () => {
        const feedback =
          (this.container.querySelector('.nps-text') as HTMLTextAreaElement)?.value || '';
        const email =
          (this.container.querySelector('.nps-input') as HTMLInputElement)?.value || '';

        this.submit(score, feedback, email);
      });

    this.container
      .querySelector('.nps-close')
      ?.addEventListener('click', () => this.close());
  }

  /* ---------------- SUBMIT ---------------- */

  private async submit(score: number, feedback: string, email?: string) {
    if (this.hasVoted) return;
    this.hasVoted = true;

    try {
      const config = getConfig();
      const baseUrl = config.endpoint || 'https://api.rojastudio.xyz';
      const endpoint = `${baseUrl.replace(/\/$/, '')}/nps`;

      const payload = {
        score,
        feedback,
        email,
        // session_id: SessionStorageService.getSessionId(),
        // user_id: SessionStorageService.getUserId(),
        url: window.location.href,
        user_agent: navigator.userAgent,
        timestamp: new Date().toISOString(),
      };

       try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + config.token,
          },
          body: JSON.stringify(payload),
          keepalive: true
        });
        
        if (response.ok) {
          this.showSuccessMessage();
          return;
        }
      } catch (error) {
        console.error('Failed to send NPS with keepalive fetch:', error);
      }

       const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + config.token,
        },
        body: JSON.stringify(payload),
        credentials: 'include',
      });

      console.log('se envia')

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      this.showSuccessMessage();
    } catch (err) {
      console.error('Error enviando NPS:', err);
      this.showErrorMessage();
    }
  }

  private showSuccessMessage() {
    this.container.innerHTML = `
      <div class="nps-card">
        <p>¡Gracias por tu opinión! 🙌</p>
      </div>
    `;
    setTimeout(() => this.close(), 2500);
  }

  private showErrorMessage() {
    this.container.innerHTML = `
      <div class="nps-card">
        <p>Ocurrió un error al enviar tu opinión. Por favor, inténtalo de nuevo más tarde.</p>
        <button class="nps-submit" style="margin-top: 10px;">Cerrar</button>
      </div>
    `;
    
    const closeBtn = this.container.querySelector('.nps-submit');
    closeBtn?.addEventListener('click', () => this.close());
  }

  /* ---------------- STYLES ---------------- */

  private applyStyles() {
    if (document.getElementById('pt-nps-styles')) return;

    const style = document.createElement('style');
    style.id = 'pt-nps-styles';
    style.textContent = `
      #pt-nps-widget {
        position: fixed;
        ${this.getPosition()};
        z-index: 999999;
        font-family: system-ui, sans-serif;
      }

      .nps-card {
        background: #fff;
        border-radius: 12px;
        padding: 16px;
        width: 300px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.15);
        position: relative;
        animation: fadeIn 0.25s ease-out;
      }

      .nps-close {
        position: absolute;
        top: 6px;
        right: 8px;
        background: none;
        border: none;
        font-size: 18px;
        cursor: pointer;
      }

      .nps-question {
        font-weight: 600;
        margin-bottom: 12px;
        color: #374151;
        font-size: 15px;
      }

      .nps-options {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
      }

      .nps-btn {
        flex: 1;
        padding: 6px 0;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        background: #fff;
        cursor: pointer;
      }

      .nps-btn:hover {
        background: ${this.config.themeColor};
        border-color: ${this.config.themeColor};
        color: #fff;
      }

      .nps-text, .nps-input {
        width: 100%;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        padding: 8px;
        margin-bottom: 8px;
      }

      .nps-submit {
        width: 100%;
        background: ${this.config.themeColor};
        color: #fff;
        border: none;
        border-radius: 8px;
        padding: 8px 0;
        font-weight: 600;
        cursor: pointer;
      }

      .nps-footer {
        font-size: 12px;
        color: #6b7280;
        text-align: center;
        margin-top: 10px;
      }

      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(15px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `;

    document.head.appendChild(style);
  }

  private getPosition() {
    switch (this.config.position) {
      case 'bottom-left': return 'bottom: 20px; left: 20px;';
      case 'bottom-center': return 'bottom: 20px; left: 50%; transform: translateX(-50%);';
      case 'top-right': return 'top: 20px; right: 20px;';
      case 'top-left': return 'top: 20px; left: 20px;';
      default: return 'bottom: 20px; right: 20px;';
    }
  }

  /* ---------------- PUBLIC ---------------- */

  public open() {
    this.renderWidget();
  }

  public close() {
    this.container?.remove();
  }
}
