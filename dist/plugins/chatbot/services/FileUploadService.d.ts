export declare class FileUploadService {
    private static instance;
    private apiEndpoint;
    private constructor();
    static getInstance(): FileUploadService;
    uploadFile(file: File, onProgress?: (progress: number) => void, token?: string): Promise<{
        url: string;
        mimeType: string;
        fileSize: number;
    }>;
    getFileType(mimeType: string): 'image' | 'document' | 'audio';
    validateFile(file: File, allowedTypes: string[], maxSizeMB: number): {
        valid: boolean;
        error?: string;
    };
}
//# sourceMappingURL=FileUploadService.d.ts.map