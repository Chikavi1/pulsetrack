import { getApiUrl } from '../../../utils/api';

export class FileUploadService {
  private static instance: FileUploadService;
  private apiEndpoint: string;

  private constructor() {
    this.apiEndpoint = getApiUrl('chat/upload');
  }

  public static getInstance(): FileUploadService {
    if (!FileUploadService.instance) {
      FileUploadService.instance = new FileUploadService();
    }
    return FileUploadService.instance;
  }

  public async uploadFile(
    file: File,
    onProgress?: (progress: number) => void,
    token?: string
  ): Promise<{ url: string; mimeType: string; fileSize: number }> {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('file', file);

      const xhr = new XMLHttpRequest();
      
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable && onProgress) {
          const progress = Math.round((event.loaded / event.total) * 100);
          onProgress(progress);
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const response = JSON.parse(xhr.responseText);
          resolve({
            url: response.url,
            mimeType: file.type,
            fileSize: file.size
          });
        } else {
          reject(new Error(`Upload failed: ${xhr.statusText}`));
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error('Upload failed due to network error'));
      });

      xhr.open('POST', this.apiEndpoint, true);
      
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }
      
      xhr.send(formData);
    });
  }

  public getFileType(mimeType: string): 'image' | 'document' | 'audio' {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('audio/')) return 'audio';
    return 'document';
  }

  public validateFile(file: File, allowedTypes: string[], maxSizeMB: number): { valid: boolean; error?: string } {
    // Check file type
    if (allowedTypes.length > 0 && !allowedTypes.some(type => file.type.startsWith(type))) {
      return { 
        valid: false, 
        error: `Tipo de archivo no permitido. Formatos permitidos: ${allowedTypes.join(', ')}` 
      };
    }

    // Check file size (convert MB to bytes)
    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      return { 
        valid: false, 
        error: `Archivo demasiado grande. Tamaño máximo: ${maxSizeMB}MB` 
      };
    }

    return { valid: true };
  }
}
