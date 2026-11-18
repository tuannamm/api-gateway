export declare class GatewayError extends Error {
    readonly status: number;
    readonly code: string;
    readonly headers: Record<string, string>;
    readonly details?: unknown | undefined;
    constructor(status: number, code: string, message: string, headers?: Record<string, string>, details?: unknown | undefined);
}
export interface ProblemDetails {
    type: string;
    title: string;
    status: number;
    detail: string;
    instance: string;
    code: string;
    requestId: string;
    details?: unknown;
}
export declare const PROBLEM_CONTENT_TYPE = "application/problem+json";
export declare function toProblem(error: GatewayError, requestId: string, instance: string): ProblemDetails;
