import type { Authenticator } from './auth/jwt-authenticator';
import type { PermissionResolver } from './auth/permission-resolver';
import type { ServiceDiscovery } from './discovery/types';
import type { LoadBalancer } from './load-balancer';
import type { RouteTable } from './route-table';
import { type RpcTransport } from './transport/types';
export type HeaderMap = Record<string, string | string[] | undefined>;
export interface IncomingRequest {
    method: string;
    url: string;
    headers: HeaderMap;
    body?: unknown;
}
export interface OutgoingResponse {
    status: number;
    headers: Record<string, string>;
    body?: unknown;
}
export interface GatewayLogger {
    log?(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}
export interface GatewayHandlerOptions {
    project: string;
    authenticator?: Authenticator;
    corsOrigins?: readonly string[];
    permissionResolver?: PermissionResolver;
    routeTable: RouteTable;
    discovery: ServiceDiscovery;
    transport: RpcTransport;
    balancer: LoadBalancer;
    rpcTimeoutMs: number;
    maxAttempts: number;
    logger?: GatewayLogger;
}
export declare class GatewayHandler {
    private readonly options;
    private readonly logger;
    private readonly corsOrigins;
    constructor(options: GatewayHandlerOptions);
    private authenticate;
    private authorize;
    handle(request: IncomingRequest): Promise<OutgoingResponse>;
    private dispatch;
    private sendWithFailover;
    private toGatewayError;
}
