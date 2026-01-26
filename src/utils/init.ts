type SuccessResponse<T> = {
  data: T;
  error: null;
  status: number;
  ok: true;
};

type ErrorResponse = {
  data: null;
  error: Error;
  status: number | null;
  ok: false;
};

type ApiResponse<T = unknown> = SuccessResponse<T> | ErrorResponse;



class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly data: unknown = null
  ) {
    super(message);
    this.name = 'ApiError';
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

const API_BASE_URL = 'http://localhost:3000';


export async function fetchInitConfig<T = unknown>(token: string): Promise<ApiResponse<T>> {
  try {
    const DEFAULT_HEADERS = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Authorization': `Bearer ${token}`
    } as const;
    
    const response = await fetch(`${API_BASE_URL}/init`, {
      method: 'GET',
      headers: { ...DEFAULT_HEADERS },
      credentials: 'include',
      mode: 'cors',
    });

    let responseData: T | null = null;
    
    // Only try to parse JSON if there's content
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      try {
        responseData = await response.json() as T;
      } catch (error) {
        console.warn('Failed to parse JSON response', error);
      }
    }

    if (!response.ok) {
      const errorData = responseData as { message?: string } | null;
      throw new ApiError(
        errorData?.message || response.statusText || 'Failed to fetch configuration',
        response.status,
        responseData
      );
    }

    return {
      data: responseData as T,
      error: null,
      status: response.status,
      ok: true,
    };
  } catch (error) {
    const normalizedError = error instanceof Error 
      ? error 
      : new Error('An unknown error occurred');
      
    return {
      data: null,
      error: normalizedError,
      status: error instanceof ApiError ? error.status : null,
      ok: false,
    };
  }
}

export type { ApiResponse };