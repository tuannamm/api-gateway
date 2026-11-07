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

  const handler = new GatewayHandler({
    project: config.project,
    routeTable,
    discovery,
    transport,
    balancer: new RoundRobinBalancer(),
    rpcTimeoutMs: config.rpcTimeoutMs,
    maxAttempts: config.failoverMaxAttempts,
    logger,
  });

  return { config, spec, handler, transport, discovery, unservedPatterns: unserved(served) };
}
