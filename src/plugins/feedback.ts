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
   currentScreenshot: string = '';
   feedbackType: FeedbackType = '';
   isSubmitting = false;

  constructor(config: FeedbackConfig) {
    if (!config.tracker) throw new Error('Feedback requires a SystemTracker instance');
    this.tracker = config.tracker;

    this.config = {
      position: 'bottom-right',
      themeColor: '#4f46e5',
      buttonText: 'Feedback',
 
      autoOpen: false,
      ...config,
    };

    this.init();
  }

   init() {
    this.createButton();
    this.createFeedbackWindow();
    this.addStyles();
    if (this.config.autoOpen) this.toggleFeedbackWindow();
  }

   

 

   getPositionClasses(): string {
    switch (this.config.position) {
      case 'bottom-left':
        return 'left-4 bottom-0';
      case 'bottom-center':
        return 'left-1/2 transform -translate-x-1/2 bottom-0';
      case 'bottom-right':
      default:
        return 'right-4 bottom-0';
    }
  }

   toggleFeedbackWindow() {
    this.isOpen = !this.isOpen;
    
    if (this.isOpen) {
      this.feedbackWindow.classList.remove('translate-y-full');
      this.container.classList.add('opacity-0', 'invisible');
    } else {
      this.feedbackWindow.classList.add('translate-y-full');
      this.container.classList.remove('opacity-0', 'invisible');
    }
  }

   setFeedbackType(type: FeedbackType, selectedBtn?: HTMLElement) {
    this.feedbackType = type;
    this.toggleForm(true);
    
    // Hide buttons container and show selected option
    const buttonsContainer = document.querySelector('.feedback-options-container');
    const selectedOptionContainer = document.getElementById('selected-option-container');
    const feedbackForm = document.getElementById('feedback-form');
    
    if (buttonsContainer) buttonsContainer.classList.add('hidden');
    if (selectedOptionContainer) {
      const optionText = type === 'error' ? 'Reportar error' : 'Sugerencia';
      const bgColor = type === 'error' ? 'bg-red-100' : 'bg-blue-100';
      const textColor = type === 'error' ? 'text-red-800' : 'text-blue-800';
      
      selectedOptionContainer.innerHTML = `
        <div class="flex items-center justify-between p-3 rounded-lg ${bgColor} ${textColor}">
          <span class="font-medium">${optionText}</span>
          <button id="change-feedback-type" class="text-sm font-medium ${type === 'error' ? 'text-red-600 hover:text-red-800' : 'text-blue-600 hover:text-blue-800'} hover:underline">
            Cambiar
          </button>
        </div>
      `;
      
      // Add event listener to the change button
      document.getElementById('change-feedback-type')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (buttonsContainer) buttonsContainer.classList.remove('hidden');
        if (selectedOptionContainer) selectedOptionContainer.innerHTML = '';
        this.feedbackType = '';
      });
      
      selectedOptionContainer.classList.remove('hidden');
    }
    
    if (feedbackForm) {
      feedbackForm.style.display = 'block';
    }
    
    // Update button styles if a button was clicked
    if (selectedBtn) {
      const isBug = type === 'error';
      const allButtons = document.querySelectorAll('.feedback-type-btn');
      
      allButtons.forEach(btn => {
        btn.classList.remove(
          'border-red-600', 'bg-red-600', 'border-blue-600', 'bg-blue-600',
          'text-white', 'font-semibold', 'shadow-md', 'ring-2', 'ring-offset-1',
          'ring-red-300', 'ring-blue-300'
        );
        btn.classList.add(
          'border-gray-300',
          'bg-white',
          'text-gray-700',
          'hover:bg-gray-50'
        );
      });
      
      selectedBtn.classList.remove(
        'border-gray-300',
        'bg-white',
        'text-gray-700',
        'hover:bg-gray-50'
      );
      
      selectedBtn.classList.add(
        isBug ? 'border-red-600' : 'border-blue-600',
        isBug ? 'bg-red-600' : 'bg-blue-600',
        'text-white',
        'font-semibold',
        'shadow-md',
        'ring-2',
        'ring-offset-1',
        isBug ? 'ring-red-300' : 'ring-blue-300'
      );
    }
    
    // Update description label
    const label = document.querySelector('label[for="feedback-description"]');
    if (label) {
      label.textContent = `Describe ${type === 'error' ? 'el error' : 'la mejora'}`;
    }
  }

   toggleForm(enable: boolean) {
    const form = document.getElementById('feedback-form');
    const submitBtn = document.getElementById('submit-feedback') as HTMLButtonElement;
    
    if (form && submitBtn) {
      form.style.display = enable ? 'block' : 'none';
      submitBtn.disabled = !enable;
    }
  }

   async captureScreenshot() {
    try {
      // Hide the feedback window temporarily
      this.feedbackWindow.style.visibility = 'hidden';
      
      // Capture the visible viewport
      const canvas = await html2canvas(document.body, {
        scale: 1,
        useCORS: true,
        logging: false,
        windowWidth: document.documentElement.scrollWidth,
        windowHeight: document.documentElement.scrollHeight,
        scrollX: -window.scrollX,
        scrollY: -window.scrollY,
        width: window.innerWidth,
        height: window.innerHeight,
        x: 0,
        y: 0,
      });
      
      this.currentScreenshot = canvas.toDataURL('image/png');
      
      // Show the screenshot preview
      const previewImg = document.getElementById('screenshot-img') as HTMLImageElement;
      const previewContainer = document.getElementById('screenshot-container');
      const previewBadge = document.getElementById('screenshot-preview');
      
      if (previewImg && previewContainer && previewBadge) {
        previewImg.src = this.currentScreenshot;
        previewContainer.classList.remove('hidden');
        previewBadge.classList.remove('hidden');
      }
      
    } catch (error) {
      console.error('Error capturing screenshot:', error);
      alert('No se pudo capturar la pantalla. Por favor, inténtalo de nuevo.');
    } finally {
      // Show the feedback window again
      this.feedbackWindow.style.visibility = 'visible';
    }
  }

   removeScreenshot() {
    this.currentScreenshot = '';
    
    const previewContainer = document.getElementById('screenshot-container');
    const previewBadge = document.getElementById('screenshot-preview');
    
    if (previewContainer && previewBadge) {
      previewContainer.classList.add('hidden');
      previewBadge.classList.add('hidden');
    }
  }

    public async getFingerprint(): Promise<string | null> {
      const fp = await FingerprintJS.load();
      const result = await fp.get();
      return result.visitorId;
  }

  getUser(){
    return localStorage.getItem('tracker_user') || 'anonymous';
  }


 async submitFeedback() {
  if (this.isSubmitting) return;

  const description = (document.getElementById('feedback-description') as HTMLTextAreaElement)?.value.trim();
  if (!description) {
    alert('Por favor, describe tu feedback');
    return;
  }

  const submitBtn = document.getElementById('submit-feedback') as HTMLButtonElement;
  const submitText = document.getElementById('submit-text');
  const submitSpinner = document.getElementById('submit-spinner');
  const form = document.getElementById('feedback-form');
  const successMessage = document.getElementById('success-message');

  if (!submitBtn || !submitText || !submitSpinner || !form || !successMessage) return;

  try {
    this.isSubmitting = true;

    submitBtn.disabled = true;
    submitText.textContent = 'Enviando...';
    submitSpinner.classList.remove('hidden');

    const { businessId } = getConfig();
    const formData = new FormData();
    formData.append('type', this.feedbackType);
    formData.append('description', description);
    formData.append('url', window.location.href);
    formData.append('userAgent', navigator.userAgent);
    formData.append('businessId', businessId);
    formData.append('fingerprint', await this.getFingerprint() || '');
    formData.append('userId', this.getUser());
    formData.append('timestamp', new Date().toISOString());
 
    if (this.currentScreenshot) {
      const blob = this.base64ToBlob(this.currentScreenshot);
      formData.append('screenshot', blob, 'screenshot.png');
    }

    this.tracker.addTag('feedback_submitted', {
      type: this.feedbackType,
      hasScreenshot: !!this.currentScreenshot,
      url: window.location.href,
      businessId,
    });

 
    const response = await fetch('https://dev.rojastudio.xyz/feedback', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`);
    }

    const feedbackContent = document.getElementById('feedback-content');

    if (feedbackContent) {
      feedbackContent.classList.add('hidden');
    }

    successMessage.classList.remove('hidden');
    successMessage.style.animation = 'fadeIn 0.3s ease-out';

    setTimeout(() => {
      this.toggleFeedbackWindow();
      setTimeout(() => this.resetForm(), 300);
    }, 3000);

  } catch (error) {
    console.error('Error submitting feedback:', error);
    alert('El feedback se guardó localmente pero no se pudo enviar al servidor.');
  } finally {
    this.isSubmitting = false;
  }
}
 
   base64ToBlob(base64: string): Blob {
    const parts = base64.split(',');
    const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/png';
    const binary = atob(parts[1]);
    const array = new Uint8Array(binary.length);
  
    for (let i = 0; i < binary.length; i++) {
      array[i] = binary.charCodeAt(i);
    }
  
    return new Blob([array], { type: mime });
  }


   resetForm() {
    const textarea = document.getElementById('feedback-description') as HTMLTextAreaElement;
    const successMessage = document.getElementById('success-message');
    const feedbackContent = document.getElementById('feedback-content');
    const form = document.getElementById('feedback-form');
    const submitBtn = document.getElementById('submit-feedback') as HTMLButtonElement;
    const submitText = document.getElementById('submit-text');
    const submitSpinner = document.getElementById('submit-spinner');
    const buttonsContainer = document.querySelector('.feedback-options-container');
    const selectedOptionContainer = document.getElementById('selected-option-container');
    
    if (textarea) textarea.value = '';
    if (successMessage) successMessage.classList.add('hidden');
    if (feedbackContent) feedbackContent.classList.remove('hidden');
    if (form) form.style.display = '';
    if (buttonsContainer) buttonsContainer.classList.remove('hidden');
    if (selectedOptionContainer) selectedOptionContainer.classList.add('hidden');

    if (submitBtn && submitText && submitSpinner) {
      submitBtn.disabled = true;
      submitText.textContent = 'Enviar feedback';
      submitSpinner.classList.add('hidden');
    }
    
    this.feedbackType = '';
    this.toggleForm(false);
    
    this.removeScreenshot();
    this.currentScreenshot = '';
    
    document.querySelectorAll('#feedback-bug, #feedback-improvement').forEach(btn => {
      btn.classList.remove('!border-red-500', '!bg-red-700', 'text-white', '!border-blue-500', '!bg-blue-700');
      btn.classList.add('!border-gray-300', '!bg-gray-100', 'text-gray-700');
    });
  }


  createButton() {
    const button = document.createElement('button');
    button.className = `fixed z-50 flex items-center justify-center px-6 py-3 rounded-full transition-all duration-300
      bg-[${this.config.themeColor}] text-white shadow-lg hover:shadow-xl
      focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[${this.config.themeColor}]
      ${this.getPositionClasses()}`;
    
    button.style.fontFamily = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    button.style.transform = 'translateY(0)';
    button.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    button.style.fontSize = '1rem';
    button.style.fontWeight = '600';
    button.style.letterSpacing = '0.025em';
    button.style.boxShadow = '0 2px 4px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.08)';
    button.style.margin = '0 0 32px 0';
    
    button.addEventListener('mouseenter', () => {
      button.style.transform = 'translateY(-2px)';
      button.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)';
    });
    
    button.addEventListener('mouseleave', () => {
      button.style.transform = 'translateY(0)';
      button.style.boxShadow = '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)';
    });
    
    button.innerHTML = `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width="16"
      height="16"
      fill="currentColor"
      style="margin-right:6px; display:inline-block; vertical-align:middle;"
    >
      <path d="M461.2 18.9C472.7 24 480 35.4 480 48l0 416c0 12.6-7.3 24-18.8 29.1s-24.8 3.2-34.3-5.1l-46.6-40.7c-43.6-38.1-98.7-60.3-156.4-63l0 95.7c0 17.7-14.3 32-32 32l-32 0c-17.7 0-32-14.3-32-32l0-96C57.3 384 0 326.7 0 256S57.3 128 128 128l84.5 0c61.8-.2 121.4-22.7 167.9-63.3l46.6-40.7c9.4-8.3 22.9-10.2 34.3-5.1zM224 320l0 .2c70.3 2.7 137.8 28.5 192 73.4l0-275.3c-54.2 44.9-121.7 70.7-192 73.4L224 320z"/>
    </svg>
    ${this.config.buttonText}
    `;
    
    button.addEventListener('click', () => {
      this.toggleFeedbackWindow();
      const { businessId } = getConfig();
      this.tracker.addTag('feedback_opened', { businessId });
    });
    
    this.container = button;
    document.body.appendChild(this.container);
  }

    createFeedbackWindow() {
    const windowElement = document.createElement('div');
    windowElement.className = `fixed z-50 w-full max-w-md bg-white rounded-t-xl shadow-2xl transition-all duration-300 transform ${
      this.isOpen ? 'translate-y-0' : 'translate-y-full'
    } ${this.getPositionClasses()} border border-gray-200 overflow-hidden`;
    
    windowElement.style.borderRadius = '12px 12px 0 0';
    windowElement.style.maxHeight = '90vh';
    windowElement.style.overflowY = 'auto';
    windowElement.style.scrollbarWidth = 'thin';
    windowElement.style.scrollbarColor = `${this.config.themeColor} transparent`;
    
    windowElement.innerHTML = `
      <div class="p-6">
        <div id="success-message" class="hidden flex flex-col items-center justify-center p-8 text-center">
          <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
            <svg class="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 class="mb-2 text-xl font-bold text-gray-900">¡Gracias por tu reporte!</h3>
          <p class="text-gray-600">Tu retroalimentación es muy valiosa para nosotros.</p>
          <button class="mt-6 rounded-md px-4 py-2 text-sm font-medium text-${this.config.themeColor} hover:bg-${this.config.themeColor}/10 transition-colors" id="close-after-submit">
            Cerrar
          </button>
        </div>

        <div id="feedback-content">
          <div class="relative mb-6">
            <div class="absolute inset-0 rounded-t-lg opacity-10"></div>
            <div class="relative flex justify-between items-center">
              <div>
                <h3 class="text-xl font-bold text-gray-900">Enviar feedback</h3>
                <p class="text-sm text-gray-500 mt-1">Ayúdanos a mejorar tu experiencia</p>
              </div>
              <button class="text-gray-400 hover:bg-gray-100 p-2 rounded-full transition-colors" id="close-feedback">
                <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div class="mb-6">
            <p class="text-sm font-medium text-gray-700 mb-3">Tipo de feedback</p>
            <div id="selected-option-container" class="mb-3 hidden"></div>
            <div class="feedback-options-container grid grid-cols-2 gap-3">
             <button 
                id="feedback-improvement" 
                class="flex !bg-blue-600 items-center justify-center gap-2 px-5 py-3 rounded-lg border-2 feedback-option ${
                  this.feedbackType === 'suggested'   
                    ? '!border-blue-500 !bg-blue-700' 
                    : '!border-gray-300 !bg-gray-100'
                } hover:!border-blue-400 hover:!bg-blue-50 transition-all duration-200"
              >
                <span>Sugerencia</span>
                ${this.feedbackType === 'suggested' ? `
                   
                ` : ''}
              </button>

              <button 
                id="feedback-bug" 
                class="flex bg-red-800 items-center justify-center gap-2 px-5 py-3 rounded-lg border-2 feedback-option ${
                  this.feedbackType === 'error' 
                    ? '!border-red-500 !bg-red-700' 
                    : '!border-gray-300 !bg-gray-100'
                } hover:!border-red-400 hover:!bg-red-50 transition-all duration-200"
              >
                <span>Reportar error</span>
                ${this.feedbackType === 'error' ? `
                 
                ` : ''}
              </button>

             
            </div>
          </div>
          
          <div class="mb-4" id="feedback-form">
            <label for="feedback-description" class="block text-sm font-medium text-gray-700 mb-1">
              ${this.feedbackType === 'error' ? 'Describe el error' : 'Describe la mejora'}
            </label>
            <div class="relative">
              <textarea 
                id="feedback-description" 
                rows="3" 
                class="w-full px-4 py-3 pr-10 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-${this.config.themeColor} focus:border-${this.config.themeColor} text-sm leading-6 bg-white text-gray-900 placeholder-gray-400 transition-all duration-200 resize-none"
                placeholder="Escribe tu mensaje aquí..."
                style="box-shadow: 0 0 0 1px rgba(0,0,0,0.05), 0 1px 3px 0 rgba(0,0,0,0.1);"
              ></textarea>
            </div>
            
            <div class="mt-2 flex items-center justify-between">
              <button 
                type="button"
                id="screenshot-btn" 
                class="inline-flex items-center px-3 py-1.5 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-${this.config.themeColor}"
              >
                <svg class="-ml-0.5 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Capturar pantalla
              </button>
              
              <div id="screenshot-preview" class="hidden">
                <div class="flex items-center gap-2">
                  <span class="text-sm text-gray-500">Captura lista</span>
                  <button id="remove-screenshot" class="text-red-500 hover:text-red-700">
                    <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
            
            <div id="screenshot-container" class="mt-2 hidden">
              <div class="rounded-md p-2">
                <img id="screenshot-img" src="" alt="Captura de pantalla" class="max-h-12" />
              </div>
            </div>
          </div>
          
          <div class="mt-8 pt-4 border-t border-gray-100">
            <button 
              id="submit-feedback" 
              class="w-full bg-black flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-${this.config.themeColor} hover:bg-opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-${this.config.themeColor} disabled:opacity-50 transition-all duration-200 transform hover:scale-[1.02]"
              style="min-height: 48px;"
              disabled
            >
              <span id="submit-text" class="font-semibold">Enviar feedback</span>
              <span id="submit-spinner" class="hidden ml-3">
                <svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </span>
            </button>
            <p class="mt-3 text-center text-xs text-gray-500">
              Impulsado por 
              <a href="https://pulsetrack.me" target="_blank" class="text-blue-500 hover:underline">
              PulseTrack
              </a>
            </p>
          </div>
        </div>
      </div>
    `;
    
    windowElement.querySelector('#close-feedback')?.addEventListener('click', () => this.toggleFeedbackWindow());
    windowElement.querySelector('#feedback-bug')?.addEventListener('click', () => this.setFeedbackType('error'));
    windowElement.querySelector('#feedback-improvement')?.addEventListener('click', () => this.setFeedbackType('suggested'));
    windowElement.querySelector('#screenshot-btn')?.addEventListener('click', () => this.captureScreenshot());
    windowElement.querySelector('#remove-screenshot')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.removeScreenshot();
    });
    windowElement.querySelector('#submit-feedback')?.addEventListener('click', () => this.submitFeedback());
    windowElement.querySelector('#close-after-submit')?.addEventListener('click', () => {
      this.toggleFeedbackWindow();
      setTimeout(() => this.resetForm(), 300);
    });
    
    windowElement.querySelector('#feedback-description')?.addEventListener('input', (e) => {
      const submitBtn = windowElement.querySelector('#submit-feedback') as HTMLButtonElement;
      if (submitBtn) {
        submitBtn.disabled = !(e.target as HTMLTextAreaElement).value.trim();
      }
    });
    
    this.feedbackWindow = windowElement;
    document.body.appendChild(this.feedbackWindow);
    this.toggleForm(false);
  }


   addStyles() {
    if (!document.getElementById('tailwind-css')) {
      const link = document.createElement('link');
      link.id = 'tailwind-css';
      link.href = 'https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css';
      link.rel = 'stylesheet';
      link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
    }
    
    const style = document.createElement('style');
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }
      
      #screenshot-container img {
        max-width: 100%;
        height: auto;
        border-radius: 4px;
        border: 1px solid #e5e7eb;
      }
      
      /* Custom scrollbar */
      ::-webkit-scrollbar {
        width: 6px;
        height: 6px;
      }
      
      ::-webkit-scrollbar-track {
        background: transparent;
        border-radius: 3px;
      }
      
      ::-webkit-scrollbar-thumb {
        background: #cbd5e0;
        border-radius: 3px;
      }
      
      ::-webkit-scrollbar-thumb:hover {
        background: #a0aec0;
      }

     .feedback-option {
        border-width: 2px;
        transition: all 0.2s ease;
      }
      
      .feedback-selected-error {
        background-color: #dc2626;
        border-color: #dc2626;
        color: white;
        box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.35);
      }
      
      .feedback-selected-suggested {
        background-color: #2563eb !important;
        border-color: #2563eb !important;
        color: white !important;
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.35) !important;
      }
      
      .feedback-unselected {
        background-color: white;
        border-color: #d1d5db;
        color: #374151;
      }
      
    `;
    document.head.appendChild(style);
  }
}

export function Feedback(config: FeedbackConfig) {
  return new FeedbackWidget(config);
}
