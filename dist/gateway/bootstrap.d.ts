import type { GatewayConfig } from './config';
import type { ServiceDiscovery } from './discovery/types';
import { GatewayHandler, type GatewayLogger } from './gateway-handler';
import { type LoadedSpec } from './spec-loader';
import type { RpcTransport } from './transport/types';
export interface Gateway {
    config: GatewayConfig;
    spec: LoadedSpec;
    handler: GatewayHandler;
    transport: RpcTransport;
    discovery: ServiceDiscovery;
    unservedPatterns: string[];
}
export declare function buildGateway(config: GatewayConfig, logger?: GatewayLogger): Promise<Gateway>;
