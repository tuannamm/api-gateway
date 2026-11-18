export interface GatewayUser {
    sub: string;
    [claim: string]: unknown;
}
export interface GatewayRequest<TBody = unknown> {
    params: Record<string, string>;
    query: Record<string, string | string[]>;
    body?: TBody;
    user?: GatewayUser;
    meta: {
        requestId: string;
        operationId: string;
        project: string;
        idempotencyKey?: string;
    };
}
export interface GatewayRpcError {
    statusCode: number;
    message: string;
    code?: string;
    details?: unknown;
}
