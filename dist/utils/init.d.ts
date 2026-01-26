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
export declare function fetchInitConfig<T = unknown>(token: string): Promise<ApiResponse<T>>;
export type { ApiResponse };
//# sourceMappingURL=init.d.ts.map