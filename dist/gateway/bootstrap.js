"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildGateway = buildGateway;
const jwt_authenticator_1 = require("./auth/jwt-authenticator");
const permission_resolver_1 = require("./auth/permission-resolver");
const errors_1 = require("./errors");
const registry_discovery_1 = require("./discovery/registry-discovery");
const gateway_handler_1 = require("./gateway-handler");
const load_balancer_1 = require("./load-balancer");
const route_table_1 = require("./route-table");
const spec_loader_1 = require("./spec-loader");
const tcp_transport_1 = require("./transport/tcp-transport");
async function buildGateway(config, logger) {
    const spec = await (0, spec_loader_1.loadSpec)(config.specPath);
    if (spec.routes.some(r => r.requiresAuth !== false) && !config.auth)
        throw new errors_1.ConfigError('Protected routes require KEYCLOAK_ISSUER and KEYCLOAK_AUDIENCE');
    const routeTable = route_table_1.RouteTable.from(spec.routes);
    const transport = new tcp_transport_1.TcpTransport();
    const specPatterns = spec.routes.map((r) => r.operationId);
    const unserved = (served) => {
        const set = new Set(served);
        return specPatterns.filter((id) => !set.has(id));
    };
    const discovery = new registry_discovery_1.RegistryDiscovery({
        registryUrl: config.discovery.url,
        pollIntervalMs: config.discovery.pollIntervalMs,
        logger,
    });
    await discovery.start();
    const served = discovery.patterns();
    discovery.onChange((patterns) => {
        const missing = unserved(patterns);
        if (missing.length)
            logger?.warn(`No instance registered for: ${missing.join(', ')} (requests will get 503)`);
    });
    const balancer = new load_balancer_1.RoundRobinBalancer();
    const needsPermissions = spec.routes.some((r) => (r.permissions?.length ?? 0) > 0);
    const permissionResolver = needsPermissions
        ? new permission_resolver_1.CachingPermissionResolver(new permission_resolver_1.RpcPermissionResolver({
            project: config.project,
            discovery,
            transport,
            balancer,
            timeoutMs: config.rpcTimeoutMs,
            maxAttempts: config.failoverMaxAttempts,
        }), { ttlMs: config.authz.cacheTtlMs, maxEntries: config.authz.cacheMaxEntries })
        : undefined;
    const handler = new gateway_handler_1.GatewayHandler({
        project: config.project,
        authenticator: config.auth ? new jwt_authenticator_1.JwtAuthenticator(config.auth.issuer, config.auth.audience) : undefined,
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
//# sourceMappingURL=bootstrap.js.map