import { ChatbotConfig, ChatMessage, ChatbotInterface } from './types';
export declare class Chatbot implements ChatbotInterface {
    private config;
    private container;
    private isVisible;
    private messageCallbacks;
    private fileUploadService;
    private token?;
    constructor(config?: Partial<ChatbotConfig>, token?: string);
    show(): void;
    hide(): void;
    toggle(): void;
    sendMessage(content: string): void;
    uploadFile(file: File): Promise<string>;
    addMessage(message: Omit<ChatMessage, 'id' | 'timestamp'>): void;
    onMessage(callback: (message: ChatMessage) => void): void;
    destroy(): void;
    private emitMessage;
    private generateId;
    private clearInput;
    private updateUploadProgress;
    private renderWelcomeMessage;
    private createChatbotContainer;
    private getPositionStyles;
    private initializeEventListeners;
    private initializeFileUpload;
    private addMessageToUI;
    private formatTime;
    private formatFileSize;
}
//# sourceMappingURL=chatbot.d.ts.map