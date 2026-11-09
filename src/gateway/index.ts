// API công khai của gateway core. Code bên ngoài (NestJS app, test e2e) chỉ import từ đây,
// để sau này tách thư mục này thành package riêng mà không phải sửa nơi dùng.
export * from './types';
export * from './errors';
export * from './contracts';
export { loadConfig, listProjects, type GatewayConfig, type DiscoveryConfig } from './config';
export { loadSpec, extractRoutes, pickSuccessStatus, type LoadedSpec } from './spec-loader';
export { RouteTable } from './route-table';
export { resolveRequestId, REQUEST_ID_HEADER } from './request-id';
export { GatewayError, toProblem, PROBLEM_CONTENT_TYPE, type ProblemDetails } from './problem';
export type { Instance, ServiceDiscovery } from './discovery/types';
export {
  RegistryDiscovery,
  type RegistryDiscoveryOptions,
  type RegistryDiscoveryLogger,
  type RefreshResult,
} from './discovery/registry-discovery';
export * from './transport/types';
export { TcpTransport } from './transport/tcp-transport';
export { RoundRobinBalancer, type LoadBalancer } from './load-balancer';
export {
  GatewayHandler,
  type GatewayHandlerOptions,
  type GatewayLogger,
  type IncomingRequest,
  type OutgoingResponse,
  type HeaderMap,
} from './gateway-handler';
export { buildGateway, type Gateway } from './bootstrap';
export {
  AUTHZ_PATTERN,
  CachingPermissionResolver,
  RpcPermissionResolver,
  type PermissionResolver,
} from './auth/permission-resolver';
