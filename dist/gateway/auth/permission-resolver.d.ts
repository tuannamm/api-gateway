import type { ServiceDiscovery } from '../discovery/types';
import type { LoadBalancer } from '../load-balancer';
import type { RpcTransport } from '../transport/types';
export interface PermissionResolver {
    permissionsOf(userId: string, requestId: string): Promise<ReadonlySet<string>>;
}
export declare const AUTHZ_PATTERN = "identity.authz.permissions";
export interface RpcPermissionResolverOptions {
    project: string;
    discovery: ServiceDiscovery;
    transport: RpcTransport;
    balancer: LoadBalancer;
    timeoutMs: number;
    maxAttempts: number;
    pattern?: string;
}
export declare class RpcPermissionResolver implements PermissionResolver {
    private readonly options;
    constructor(options: RpcPermissionResolverOptions);
    permissionsOf(userId: string, requestId: string): Promise<ReadonlySet<string>>;
}
export declare function parsePermissions(result: unknown): ReadonlySet<string>;
export interface CachingPermissionResolverOptions {
    ttlMs: number;
    maxEntries: number;
    now?: () => number;
}
export declare class CachingPermissionResolver implements PermissionResolver {
    private readonly inner;
    private readonly options;
    private readonly entries;
    private readonly inflight;
    private readonly now;
    constructor(inner: PermissionResolver, options: CachingPermissionResolverOptions);
    permissionsOf(userId: string, requestId: string): Promise<ReadonlySet<string>>;
    private store;
}
