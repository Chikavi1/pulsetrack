export interface ChatMessage {
    id: string;
    content: string;
    sender: 'user' | 'bot';
    timestamp: Date;
    type: 'text' | 'image' | 'document' | 'audio';
    url?: string;
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
}
export interface ChatbotConfig {
    position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
    themeColor?: string;
    title?: string;
    subtitle?: string;
    welcomeMessage?: string;
    placeholderText?: string;
    showHeader?: boolean;
    showInputArea?: boolean;
    allowFileUploads?: boolean;
    maxFileSizeMB?: number;
    allowedFileTypes?: string[];
}
export interface FileUploadOptions {
    file: File;
    onProgress?: (progress: number) => void;
    onSuccess: (url: string) => void;
    onError: (error: Error) => void;
}
export interface ChatbotInterface {
    show(): void;
    hide(): void;
    toggle(): void;
    sendMessage(content: string): void;
    uploadFile(file: File): Promise<string>;
    addMessage(message: Omit<ChatMessage, 'id' | 'timestamp'>): void;
    onMessage(callback: (message: ChatMessage) => void): void;
    destroy(): void;
}
//# sourceMappingURL=types.d.ts.map