


import { ChatbotConfig, ChatMessage, ChatbotInterface } from './types';
import { FileUploadService } from './services/FileUploadService';

const DEFAULT_CONFIG: Required<ChatbotConfig> = {
  position: 'bottom-right',
  themeColor: '#3b82f6',
  title: 'Asistente Virtual',
  subtitle: '¿En qué puedo ayudarte hoy?',
  welcomeMessage: '¡Hola! ¿En qué puedo ayudarte?',
  placeholderText: 'Escribe tu mensaje...',
  showHeader: true,
  showInputArea: true,
  allowFileUploads: true,
  maxFileSizeMB: 10,
  allowedFileTypes: [
    'image/*',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'audio/*'
  ]
};

export class Chatbot implements ChatbotInterface {
  private config: Required<ChatbotConfig>;
  private container: HTMLElement;
  private isVisible: boolean = false;
  private messageCallbacks: ((message: ChatMessage) => void)[] = [];
  private fileUploadService: FileUploadService;
  private token?: string;

  constructor(config: Partial<ChatbotConfig> = {}, token?: string) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.token = token;
    this.fileUploadService = FileUploadService.getInstance();
    this.container = this.createChatbotContainer();
    this.initializeEventListeners();
    this.renderWelcomeMessage();
  }

  /* Public API */
  public show(): void {
    this.container.style.display = 'flex';
    this.isVisible = true;
  }

  public hide(): void {
    this.container.style.display = 'none';
    this.isVisible = false;
  }

  public toggle(): void {
    this.isVisible ? this.hide() : this.show();
  }

  public sendMessage(content: string): void {
    if (!content.trim()) return;
    
    const message: ChatMessage = {
      id: this.generateId(),
      content,
      sender: 'user',
      timestamp: new Date(),
      type: 'text'
    };
    
    this.addMessageToUI(message);
    this.emitMessage(message);
    this.clearInput();
  }

  public async uploadFile(file: File): Promise<string> {
    try {
      const { valid, error } = this.fileUploadService.validateFile(
        file, 
        this.config.allowedFileTypes, 
        this.config.maxFileSizeMB
      );

      if (!valid) {
        throw new Error(error || 'Invalid file');
      }

      const { url, mimeType, fileSize } = await this.fileUploadService.uploadFile(
        file,
        (progress) => this.updateUploadProgress(progress),
        this.token
      );

      const messageType = this.fileUploadService.getFileType(mimeType);
      
      const message: ChatMessage = {
        id: this.generateId(),
        content: file.name,
        sender: 'user',
        timestamp: new Date(),
        type: messageType,
        url,
        fileName: file.name,
        fileSize,
        mimeType
      };

      this.addMessageToUI(message);
      this.emitMessage(message);
      
      return url;
    } catch (error) {
      console.error('Error uploading file:', error);
      throw error;
    }
  }

  public addMessage(message: Omit<ChatMessage, 'id' | 'timestamp'>): void {
    const newMessage: ChatMessage = {
      ...message,
      id: this.generateId(),
      timestamp: new Date()
    };
    
    this.addMessageToUI(newMessage);
    this.emitMessage(newMessage);
  }

  public onMessage(callback: (message: ChatMessage) => void): void {
    this.messageCallbacks.push(callback);
  }

  public destroy(): void {
    this.container.remove();
    // Clean up any event listeners or intervals here
  }

  /* Private methods */
  private emitMessage(message: ChatMessage): void {
    this.messageCallbacks.forEach(callback => callback(message));
  }

  private generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }

  private clearInput(): void {
    const input = this.container.querySelector('input[type="text"]') as HTMLInputElement;
    if (input) input.value = '';
  }

  private updateUploadProgress(progress: number): void {
    // Implement progress UI update
    console.log(`Upload progress: ${progress}%`);
  }

  private renderWelcomeMessage(): void {
    if (this.config.welcomeMessage) {
      this.addMessage({
        content: this.config.welcomeMessage,
        sender: 'bot',
        type: 'text'
      });
    }
  }

  private createChatbotContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'pulsetrack-chatbot';
    container.style.cssText = `
      position: fixed;
      ${this.getPositionStyles()};
      width: 350px;
      height: 500px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      display: flex;
      flex-direction: column;
      z-index: 9999;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    container.innerHTML = `
      ${this.config.showHeader ? `
        <div class="chatbot-header" style="
          background: ${this.config.themeColor};
          color: white;
          padding: 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        ">
          <div>
            <div style="font-weight: 600; font-size: 16px;">${this.config.title}</div>
            <div style="font-size: 12px; opacity: 0.9;">${this.config.subtitle}</div>
          </div>
          <button class="chatbot-close" style="
            background: none;
            border: none;
            color: white;
            font-size: 20px;
            cursor: pointer;
          ">×</button>
        </div>
      ` : ''}
      
      <div class="chatbot-messages" style="
        flex: 1;
        overflow-y: auto;
        padding: 16px;
      "></div>
      
      ${this.config.showInputArea ? `
        <div class="chatbot-input" style="
          border-top: 1px solid #eee;
          padding: 12px;
          display: flex;
          gap: 8px;
        ">
          <input type="text" 
            placeholder="${this.config.placeholderText}" 
            style="
              flex: 1;
              padding: 8px 12px;
              border: 1px solid #ddd;
              border-radius: 20px;
              outline: none;
            "
          >
          <button class="send-button" style="
            background: ${this.config.themeColor};
            color: white;
            border: none;
            border-radius: 50%;
            width: 36px;
            height: 36px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
          ">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </div>
      ` : ''}
    `;

    document.body.appendChild(container);
    return container;
  }

  private getPositionStyles(): string {
    switch (this.config.position) {
      case 'top-left':
        return 'top: 20px; left: 20px;';
      case 'top-right':
        return 'top: 20px; right: 20px;';
      case 'bottom-left':
        return 'bottom: 20px; left: 20px;';
      case 'bottom-right':
      default:
        return 'bottom: 20px; right: 20px;';
    }
  }

  private initializeEventListeners(): void {
    // Send message on button click
    const sendButton = this.container.querySelector('.send-button');
    const input = this.container.querySelector('input[type="text"]') as HTMLInputElement;
    
    const sendMessage = () => {
      if (input && input.value.trim()) {
        this.sendMessage(input.value.trim());
      }
    };

    sendButton?.addEventListener('click', sendMessage);
    
    // Send message on Enter key
    input?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        sendMessage();
      }
    });

    // Close button
    const closeButton = this.container.querySelector('.chatbot-close');
    closeButton?.addEventListener('click', () => this.hide());

    // File upload (if enabled)
    if (this.config.allowFileUploads) {
      this.initializeFileUpload();
    }
  }

  private initializeFileUpload(): void {
    const input = this.container.querySelector('input[type="text"]') as HTMLInputElement;
    const inputContainer = input?.parentElement;
    
    if (!inputContainer) return;

    // Create file input
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = this.config.allowedFileTypes.join(',');
    fileInput.multiple = false;
    fileInput.style.display = 'none';
    
    // Add file input button
    const fileButton = document.createElement('button');
    fileButton.type = 'button';
    fileButton.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="17 8 12 3 7 8"></polyline>
        <line x1="12" y1="3" x2="12" y2="15"></line>
      </svg>
    `;
    fileButton.style.cssText = `
      background: none;
      border: none;
      color: ${this.config.themeColor};
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 4px;
    `;

    fileButton.addEventListener('click', () => fileInput.click());
    
    // Handle file selection
    fileInput.addEventListener('change', async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;
      
      try {
        await this.uploadFile(files[0]);
      } catch (error) {
        console.error('Error uploading file:', error);
        // Show error message to user
        this.addMessage({
          content: 'Error al subir el archivo. Inténtalo de nuevo.',
          sender: 'bot',
          type: 'text'
        });
      } finally {
        // Reset file input
        fileInput.value = '';
      }
    });

    inputContainer.insertBefore(fileButton, input);
    inputContainer.appendChild(fileInput);
  }

  private addMessageToUI(message: ChatMessage): void {
    const messagesContainer = this.container.querySelector('.chatbot-messages');
    if (!messagesContainer) return;

    const messageElement = document.createElement('div');
    messageElement.className = `message ${message.sender}`;
    messageElement.style.cssText = `
      margin-bottom: 12px;
      display: flex;
      flex-direction: column;
      align-items: ${message.sender === 'user' ? 'flex-end' : 'flex-start'};
    `;

    let contentHTML = '';
    
    switch (message.type) {
      case 'image':
        contentHTML = `
          <img 
            src="${message.url}" 
            alt="${message.fileName || 'Imagen'}"
            style="
              max-width: 200px;
              max-height: 200px;
              border-radius: 8px;
              margin-top: 4px;
              cursor: pointer;"
            onclick="window.open('${message.url}', '_blank')"
          >
        `;
        break;
        
      case 'document':
        contentHTML = `
          <a 
            href="${message.url}" 
            target="_blank"
            style="
              display: flex;
              align-items: center;
              gap: 8px;
              color: ${this.config.themeColor};
              text-decoration: none;
              padding: 8px 12px;
              background: ${this.config.themeColor}10;
              border-radius: 8px;
              margin-top: 4px;
            "
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px;">
              ${message.fileName || 'Documento'}
            </span>
            <span style="font-size: 12px; color: #666;">
              ${this.formatFileSize(message.fileSize || 0)}
            </span>
          </a>
        `;
        break;
        
      case 'audio':
        contentHTML = `
          <div style="margin-top: 4px;">
            <audio controls style="width: 100%; max-width: 250px;">
              <source src="${message.url}" type="${message.mimeType || 'audio/mp3'}">
              Tu navegador no soporta el elemento de audio.
            </audio>
          </div>
        `;
        break;
        
      default: // text
        contentHTML = `
          <div style="
            background: ${message.sender === 'user' ? this.config.themeColor : '#f0f0f0'};
            color: ${message.sender === 'user' ? 'white' : '#333'};
            padding: 8px 12px;
            border-radius: 12px;
            max-width: 80%;
            word-wrap: break-word;
          ">
            ${message.content}
          </div>
        `;
    }

    messageElement.innerHTML = `
      <div style="
        font-size: 11px;
        color: #999;
        margin-bottom: 4px;
        text-align: ${message.sender === 'user' ? 'right' : 'left'};
      ">
        ${message.sender === 'user' ? 'Tú' : 'Asistente'}
        <span style="margin: 0 4px">•</span>
        ${this.formatTime(message.timestamp)}
      </div>
      ${contentHTML}
    `;

    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  private formatTime(date: Date): string {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}