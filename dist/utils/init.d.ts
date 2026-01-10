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
/**
 * Fetches configuration from the init endpoint
 * @param businessId The business ID to fetch configuration for
 */
export declare function fetchInitConfig<T = unknown>(businessId: string): Promise<ApiResponse<T>>;
export type { ApiResponse };
//# sourceMappingURL=init.d.ts.map