import type { GatewayConfig } from './config';
import { StaticDiscovery } from './discovery/static-discovery';
import { GatewayHandler, type GatewayLogger } from './gateway-handler';
import { RoundRobinBalancer } from './load-balancer';
import { RouteTable } from './route-table';
import { loadSpec, type LoadedSpec } from './spec-loader';
import { TcpTransport } from './transport/tcp-transport';
import type { RpcTransport } from './transport/types';

/**
 * CONTROL PLANE gom lại: từ config dựng mọi thứ data plane cần.
 * Chạy MỘT LẦN trước khi server nhận request. Lỗi nào cũng ném ra ngay (fail-fast).
 */
export interface Gateway {
  config: GatewayConfig;
  spec: LoadedSpec;
  handler: GatewayHandler;
  transport: RpcTransport;
  /** Pattern có trong spec nhưng chưa có instance nào đăng ký (sẽ trả 503). */
  unservedPatterns: string[];
}

export async function buildGateway(config: GatewayConfig, logger?: GatewayLogger): Promise<Gateway> {
  const spec = await loadSpec(config.specPath);
  const routeTable = RouteTable.from(spec.routes);
  const discovery = StaticDiscovery.fromFile(config.discoveryFile);
  const transport = new TcpTransport();

  const served = new Set(discovery.patterns(config.project));
  const unservedPatterns = spec.routes.map((r) => r.operationId).filter((id) => !served.has(id));

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

  return { config, spec, handler, transport, unservedPatterns };
}
