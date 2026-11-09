import { JwtAuthenticator } from './auth/jwt-authenticator';
import { CachingPermissionResolver, RpcPermissionResolver } from './auth/permission-resolver';
import { ConfigError } from './errors';
import type { GatewayConfig } from './config';
import { RegistryDiscovery } from './discovery/registry-discovery';
import type { ServiceDiscovery } from './discovery/types';
import { GatewayHandler, type GatewayLogger } from './gateway-handler';
import { RoundRobinBalancer } from './load-balancer';
import { RouteTable } from './route-table';
import { loadSpec, type LoadedSpec } from './spec-loader';
import { TcpTransport } from './transport/tcp-transport';
import type { RpcTransport } from './transport/types';

/**
 * CONTROL PLANE gom lại: từ config dựng mọi thứ data plane cần.
 * Chạy MỘT LẦN trước khi server nhận request. Lỗi config/spec ném ra ngay (fail-fast).
 * Riêng registry chết thì KHÔNG fail: gateway vẫn chạy và tự đồng bộ khi registry sống lại (AP).
 */
export interface Gateway {
  config: GatewayConfig;
  spec: LoadedSpec;
  handler: GatewayHandler;
  transport: RpcTransport;
  discovery: ServiceDiscovery;
  /** Pattern có trong spec nhưng lúc khởi động chưa có instance nào xử lý (sẽ trả 503). */
  unservedPatterns: string[];
}

export async function buildGateway(config: GatewayConfig, logger?: GatewayLogger): Promise<Gateway> {
  const spec = await loadSpec(config.specPath);
  if (spec.routes.some(r => r.requiresAuth !== false) && !config.auth) throw new ConfigError('Protected routes require KEYCLOAK_ISSUER and KEYCLOAK_AUDIENCE');
  const routeTable = RouteTable.from(spec.routes);
  const transport = new TcpTransport();
  const specPatterns = spec.routes.map((r) => r.operationId);
  const unserved = (served: string[]) => {
    const set = new Set(served);
    return specPatterns.filter((id) => !set.has(id));
  };

  const discovery = new RegistryDiscovery({
    registryUrl: config.discovery.url,
    pollIntervalMs: config.discovery.pollIntervalMs,
    logger,
  });
  await discovery.start();
  const served = discovery.patterns();
  // Registry thay đổi liên tục: mỗi lần bảng đổi, nhắc lại pattern nào đang không có ai xử lý.
  discovery.onChange((patterns) => {
    const missing = unserved(patterns);
    if (missing.length) logger?.warn(`No instance registered for: ${missing.join(', ')} (requests will get 503)`);
  });

  const balancer = new RoundRobinBalancer();
  const needsPermissions = spec.routes.some((r) => (r.permissions?.length ?? 0) > 0);
  const permissionResolver = needsPermissions
    ? new CachingPermissionResolver(
        new RpcPermissionResolver({
          project: config.project,
          discovery,
          transport,
          balancer,
          timeoutMs: config.rpcTimeoutMs,
          maxAttempts: config.failoverMaxAttempts,
        }),
        { ttlMs: config.authz.cacheTtlMs, maxEntries: config.authz.cacheMaxEntries },
      )
    : undefined;

  const handler = new GatewayHandler({
    project: config.project,
    authenticator: config.auth ? new JwtAuthenticator(config.auth.issuer, config.auth.audience) : undefined,
    permissionResolver,
    corsOrigins: config.corsOrigins,
    routeTable,
    discovery,
    transport,
    balancer,
    rpcTimeoutMs: config.rpcTimeoutMs,
    maxAttempts: config.failoverMaxAttempts,
    logger,
  });

  return { config, spec, handler, transport, discovery, unservedPatterns: unserved(served) };
}
