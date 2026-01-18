import { getConfig } from '../core/config';
import { SystemTracker } from '../core/tracker';
import html2canvas from 'html2canvas';
import FingerprintJS from '@fingerprintjs/fingerprintjs';

type FeedbackType = 'error' | 'suggested' | '';

export interface FeedbackConfig {
  tracker: SystemTracker;
  position?: 'bottom-right' | 'bottom-left' | 'bottom-center';
  themeColor?: string;
  buttonText?: string;
  autoOpen?: boolean;
}

class FeedbackWidget {
  tracker: SystemTracker;
  config: Required<Omit<FeedbackConfig, 'tracker'>> & { tracker: SystemTracker };

  container!: HTMLElement;
  feedbackWindow!: HTMLElement;

  isOpen = false;
  isSubmitting = false;
  feedbackType: FeedbackType = '';
  currentScreenshot = '';

  constructor(config: FeedbackConfig) {
    if (!config.tracker) throw new Error('Feedback requires tracker');

   

    this.tracker = config.tracker;
    this.config = {
      position: config.position || 'bottom-left',
      themeColor: config.themeColor || '#4f46e5',
      buttonText: config.buttonText || 'Feedback',
      autoOpen: config.autoOpen || false,
      ...config,
    };
    this.init();
  }

  init() {
    this.addStyles();
    this.createButton();
    this.createFeedbackWindow();
    if (this.config.autoOpen === true) this.toggleFeedbackWindow();
  }

  getPositionStyle() {
    switch (this.config.position) {
      case 'bottom-left':
        return 'left:16px; bottom:16px;';
      case 'bottom-center':
        return 'left:50%; bottom:16px; transform:translateX(-50%);';
      default:
        return 'right:16px; bottom:16px;';
    }
  }

  toggleFeedbackWindow() {
    this.isOpen = !this.isOpen;
    this.feedbackWindow.classList.toggle('pt-open', this.isOpen);
    this.container.style.opacity = this.isOpen ? '0' : '1';
    this.container.style.pointerEvents = this.isOpen ? 'none' : 'auto';
  }

  setFeedbackType(type: FeedbackType) {
    this.feedbackType = type;
    (document.getElementById('pt-options') as HTMLElement).style.display = 'none';

    const badge = document.getElementById('pt-selected')!;
    badge.innerHTML = `
      <div class="pt-badge ${type}">
        <span>${type === 'error' ? 'Reportar error' : 'Enviar sugerencia'}</span>
        <button id="pt-change">Cambiar</button>
      </div>
    `;
    badge.style.display = 'block';

    document.getElementById('pt-change')!.onclick = () => {
      badge.style.display = 'none';
      (document.getElementById('pt-options') as HTMLElement).style.display = 'grid';
      this.feedbackType = '';
    };
  }

  async captureScreenshot() {
    this.feedbackWindow.style.visibility = 'hidden';
    const canvas = await html2canvas(document.body, { scale: 1 });
    this.feedbackWindow.style.visibility = 'visible';

    this.currentScreenshot = canvas.toDataURL('image/png');
    (document.getElementById('pt-shot-img') as HTMLImageElement).src =
      this.currentScreenshot;
    (document.getElementById('pt-shot') as HTMLElement).style.display = 'block';
  }

  removeScreenshot() {
    this.currentScreenshot = '';
    (document.getElementById('pt-shot') as HTMLElement).style.display = 'none';
  }

  async getFingerprint() {
    const fp = await FingerprintJS.load();
    return (await fp.get()).visitorId;
  }

  getUser() {
    return localStorage.getItem('tracker_user') || 'anonymous';
  }

  base64ToBlob(base64: string): Blob {
    const [, data] = base64.split(',');
    const bytes = atob(data);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new Blob([arr], { type: 'image/png' });
  }

  async submitFeedback() {
    const textarea = document.getElementById('pt-text') as HTMLTextAreaElement;
    if (!textarea.value.trim()) return alert('Describe el feedback');

    const { businessId } = getConfig();
    const fd = new FormData();

    fd.append('type', this.feedbackType);
    fd.append('description', textarea.value);
    fd.append('url', location.href);
    fd.append('businessId', businessId);
    fd.append('fingerprint', await this.getFingerprint());
    fd.append('userId', this.getUser());

    if (this.currentScreenshot) {
      fd.append('screenshot', this.base64ToBlob(this.currentScreenshot));
    }

    await fetch('https://api.rojastudio.xyz/feedback', {
      method: 'POST',
      body: fd,
    });

    (document.getElementById('pt-content') as HTMLElement).style.display = 'none';
    (document.getElementById('pt-success') as HTMLElement).style.display = 'block';

    setTimeout(() => {
      this.toggleFeedbackWindow();
      this.resetForm();
    }, 2000);
  }

  resetForm() {
    (document.getElementById('pt-text') as HTMLTextAreaElement).value = '';
    this.removeScreenshot();
    (document.getElementById('pt-content') as HTMLElement).style.display = 'block';
    (document.getElementById('pt-success') as HTMLElement).style.display = 'none';
  }

  createButton() {
    const btn = document.createElement('button');
    btn.className = 'pt-btn';
    btn.style.cssText = this.getPositionStyle();
    btn.textContent = this.config.buttonText;
    btn.onclick = () => this.toggleFeedbackWindow();
    this.container = btn;
    document.body.appendChild(btn);
  }

  createFeedbackWindow() {
    const el = document.createElement('div');
    el.className = 'pt-window';
    el.style.cssText = this.getPositionStyle();

    el.innerHTML = `
      <div class="pt-header">
        <h3>Feedback</h3>
        <p>Ayúdanos a mejorar</p>
        <button id="pt-close" class="pt-close">✕</button>
      </div>

      <div class="pt-body">
        <div id="pt-success" class="pt-success">Gracias por tu feedback</div>

        <div id="pt-content">
          <div id="pt-options" class="pt-options">
            <button id="pt-suggest">Sugerencia</button>
            <button id="pt-error">Error</button>
          </div>

          <div id="pt-selected"></div>

          <textarea
            id="pt-text"
            placeholder="Cuéntanos con detalle..."
          ></textarea>

          <button id="pt-shot-btn" class="pt-secondary">
            Capturar pantalla
          </button>

          <div id="pt-shot">
            <img id="pt-shot-img"/>
            <button id="pt-shot-remove" class="pt-link">Quitar captura</button>
          </div>

          <button id="pt-submit" class="pt-primary">
            Enviar feedback
          </button>

          

          <div class="pt-footer">
            Powered by <strong><a href="https://rojastudio.xyz" target="_blank">PulseTrack</a></strong>
          </div>
        </div>
      </div>
    `;

    const suggestBtn = el.querySelector<HTMLButtonElement>('#pt-suggest');
    const errorBtn = el.querySelector<HTMLButtonElement>('#pt-error');
    const shotBtn = el.querySelector<HTMLButtonElement>('#pt-shot-btn');
    const shotRemoveBtn = el.querySelector<HTMLButtonElement>('#pt-shot-remove');
    const submitBtn = el.querySelector<HTMLButtonElement>('#pt-submit');
    const closeBtn = el.querySelector<HTMLButtonElement>('#pt-close');

    if (suggestBtn) suggestBtn.onclick = () => this.setFeedbackType('suggested');
    if (errorBtn) errorBtn.onclick = () => this.setFeedbackType('error');
    if (shotBtn) shotBtn.onclick = () => this.captureScreenshot();
    if (shotRemoveBtn) shotRemoveBtn.onclick = () => this.removeScreenshot();
    if (submitBtn) submitBtn.onclick = () => this.submitFeedback();
    if (closeBtn) closeBtn.onclick = () => this.toggleFeedbackWindow();

    this.feedbackWindow = el;
    document.body.appendChild(el);
  }

  addStyles() {
    if (document.getElementById('pt-styles')) return;

    const s = document.createElement('style');
    s.id = 'pt-styles';
    s.textContent = `
      .pt-btn{
        position:fixed;z-index:999999;
        padding:12px 20px;border-radius:999px;
        background:${this.config.themeColor};
        color:#fff;font-weight:600;border:none;
        box-shadow:0 10px 25px rgba(0,0,0,.2);
        cursor:pointer;
      }
      .pt-window{
        position:fixed;z-index:999999;
        width:360px;background:#fff;
        border-radius:16px 16px 0 0;
        transform:translateY(120%);
        transition:.25s;
        box-shadow:0 -10px 30px rgba(0,0,0,.15);
        font-family:system-ui;
      }
      .pt-window.pt-open{transform:translateY(0)}
      .pt-header{padding:16px;border-bottom:1px solid #eee;position:relative}
      .pt-header h3{margin:0;font-size:18px}
      .pt-header p{margin:4px 0 0;color:#666;font-size:13px}

      .pt-close{
        position:absolute;
        top:10px;
        right:12px;
        background:none;
        border:none;
        font-size:18px;
        cursor:pointer;
        color:#666;
      }

      .pt-body{padding:16px}
      .pt-options{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .pt-options button{padding:10px;border-radius:8px;border:1px solid #ddd}

      textarea{
        width:100%;
        margin-top:10px;
        padding:12px;
        border-radius:8px;
        border:1px solid #ddd;
        min-height:140px;
        resize:none;
      }

      .pt-primary{
        margin-top:12px;
        width:100%;
        padding:12px;
        border-radius:10px;
        background:${this.config.themeColor};
        color:#fff;
        font-weight:600;
        border:none;
        cursor:pointer;
      }

      .pt-secondary{
        margin-top:10px;
        font-size:12px;
        color: #666;
        cursor:pointer;
      }

      #pt-shot-remove{
        margin-top:10px;
        font-size:12px;
        color: #aa0a0aff;
        cursor:pointer;
      }
        
      .pt-link{
        background:none;
        border:none;
        color:#666;
        margin-top:6px;
        cursor:pointer;
      }

      .pt-badge{
        display:flex;
        justify-content:space-between;
        padding:8px;
        border-radius:8px;
        margin:8px 0
      }
      .pt-badge.error{background:#fee2e2;color:#991b1b}
      .pt-badge.suggested{background:#dbeafe;color:#1e40af}
      .pt-success{text-align:center;font-weight:600;display:none;margin:10em 0em;}

      #pt-shot{display:none;margin-top:8px}
      #pt-shot img{
        width:30%;
        max-height:220px;
        object-fit:contain;
        border-radius:8px;
        border:1px solid #e5e7eb;
      }

      .pt-footer{
        margin-top:12px;
        padding-top:10px;
        border-top:1px solid #eee;
        font-size:12px;
        text-align:center;
        color:#888;
      }
    `;
    document.head.appendChild(s);
  }
}

export function Feedback(config: FeedbackConfig) {
  return new FeedbackWidget(config);
}
