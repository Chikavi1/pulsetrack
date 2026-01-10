type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type RequestOptions = {
    headers?: Record<string, string>;
    params?: Record<string, string | number | boolean>;
    body?: unknown;
    signal?: AbortSignal;
};
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
declare class ApiError<T = unknown> extends Error {
    readonly status: number;
    readonly data: T | null;
    constructor(message: string, status: number, data?: T | null);
}
export declare const api: {
    get: <T = unknown>(url: string, options?: Omit<RequestOptions, "body">) => Promise<ApiResponse<T>>;
    post: <T = unknown, B = unknown>(url: string, body?: B, options?: Omit<RequestOptions, "body">) => Promise<ApiResponse<T>>;
    put: <T = unknown, B = unknown>(url: string, body?: B, options?: Omit<RequestOptions, "body">) => Promise<ApiResponse<T>>;
    patch: <T = unknown, B = unknown>(url: string, body?: B, options?: Omit<RequestOptions, "body">) => Promise<ApiResponse<T>>;
    delete: <T = unknown>(url: string, options?: RequestOptions) => Promise<ApiResponse<T>>;
    config: {
        request: <T = unknown>(method: HttpMethod, url: string, options?: RequestOptions) => Promise<ApiResponse<T>>;
        fetchConfig: <T = any>(businessId: string) => Promise<ApiResponse<T>>;
    };
};
export type { ApiResponse, RequestOptions, ApiError };
//# sourceMappingURL=api.d.ts.map