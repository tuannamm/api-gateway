"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GatewayHandler = void 0;
const problem_1 = require("./problem");
const request_id_1 = require("./request-id");
const types_1 = require("./transport/types");
const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const MAX_IDEMPOTENCY_KEY_LENGTH = 255;
const CORS_ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE';
const CORS_ALLOWED_HEADERS = 'authorization, content-type, x-request-id, idempotency-key';
const CORS_EXPOSED_HEADERS = 'x-request-id';
const CORS_MAX_AGE_SECONDS = '600';
const silentLogger = { warn: () => undefined, error: () => undefined };
class GatewayHandler {
    options;
    logger;
    corsOrigins;
    constructor(options) {
        this.options = options;
        this.logger = options.logger ?? silentLogger;
        this.corsOrigins = new Set(options.corsOrigins ?? []);
    }
    async authenticate(header) {
        if (!this.options.authenticator)
            throw new problem_1.GatewayError(503, 'AUTH_UNAVAILABLE', 'Authentication is not configured');
        return this.options.authenticator.authenticate(header);
    }
    async authorize(route, user, requestId) {
        const required = route.permissions ?? [];
        if (required.length === 0)
            return;
        const resolver = this.options.permissionResolver;
        if (!user || !resolver) {
            this.logger.error(`[${requestId}] "${route.operationId}" requires permissions but no resolver/user is available`);
            throw new problem_1.GatewayError(503, 'AUTHZ_UNAVAILABLE', 'Authorization is temporarily unavailable');
        }
        let granted;
        try {
            granted = await resolver.permissionsOf(user.sub, requestId);
        }
        catch (error) {
            this.logger.error(`[${requestId}] permission lookup failed: ${error?.message ?? String(error)}`);
            throw new problem_1.GatewayError(503, 'AUTHZ_UNAVAILABLE', 'Authorization is temporarily unavailable');
        }
        if (!required.every((key) => granted.has(key))) {
            throw new problem_1.GatewayError(403, 'FORBIDDEN', 'You do not have permission to perform this operation');
        }
    }
    async handle(request) {
        if (this.corsOrigins.size === 0)
            return this.dispatch(request);
        const origin = firstHeader(request.headers.origin);
        const allowed = origin !== undefined && this.corsOrigins.has(origin);
        const isPreflight = request.method.toUpperCase() === 'OPTIONS' &&
            origin !== undefined &&
            firstHeader(request.headers['access-control-request-method']) !== undefined;
        if (isPreflight) {
            const requestId = (0, request_id_1.resolveRequestId)(request.headers[request_id_1.REQUEST_ID_HEADER]);
            if (!allowed) {
                const error = new problem_1.GatewayError(403, 'CORS_ORIGIN_NOT_ALLOWED', 'Origin is not allowed');
                return {
                    status: 403,
                    headers: { 'content-type': problem_1.PROBLEM_CONTENT_TYPE, [request_id_1.REQUEST_ID_HEADER]: requestId, vary: 'Origin' },
                    body: (0, problem_1.toProblem)(error, requestId, new URL(request.url, 'http://gateway').pathname),
                };
            }
            return {
                status: 204,
                headers: {
                    'access-control-allow-origin': origin,
                    'access-control-allow-methods': CORS_ALLOWED_METHODS,
                    'access-control-allow-headers': CORS_ALLOWED_HEADERS,
                    'access-control-max-age': CORS_MAX_AGE_SECONDS,
                    vary: 'Origin',
                },
            };
        }
        const response = await this.dispatch(request);
        return {
            ...response,
            headers: {
                ...response.headers,
                vary: 'Origin',
                ...(allowed && {
                    'access-control-allow-origin': origin,
                    'access-control-expose-headers': CORS_EXPOSED_HEADERS,
                }),
            },
        };
    }
    async dispatch(request) {
        const requestId = (0, request_id_1.resolveRequestId)(request.headers[request_id_1.REQUEST_ID_HEADER]);
        const { pathname, query } = parseUrl(request.url);
        try {
            const match = this.options.routeTable.match(request.method, pathname);
            switch (match.kind) {
                case 'not_found':
                    throw new problem_1.GatewayError(404, 'ROUTE_NOT_FOUND', `No route for ${request.method} ${pathname}`);
                case 'method_not_allowed':
                    throw new problem_1.GatewayError(405, 'METHOD_NOT_ALLOWED', `${request.method} is not allowed on ${pathname}`, { allow: match.allowed.map((m) => m.toUpperCase()).join(', ') });
                case 'invalid_path':
                    throw new problem_1.GatewayError(400, 'INVALID_PATH', 'Path contains malformed percent-encoding');
            }
            const { route, params } = match;
            const user = route.requiresAuth !== false
                ? await this.authenticate(request.headers.authorization)
                : undefined;
            await this.authorize(route, user, requestId);
            const payload = {
                params,
                query,
                ...(user && { user }),
                ...(request.body !== undefined && { body: request.body }),
                meta: {
                    requestId,
                    operationId: route.operationId,
                    project: this.options.project,
                    ...idempotencyKey(request.headers),
                },
            };
            const instances = await this.options.discovery.resolve(route.operationId);
            if (instances.length === 0) {
                this.logger.warn(`[${requestId}] no instance handles pattern "${route.operationId}"`);
                throw new problem_1.GatewayError(503, 'NO_INSTANCE', `No service instance is available for "${route.operationId}"`);
            }
            const result = await this.sendWithFailover(instances, route.operationId, payload, requestId);
            const headers = { [request_id_1.REQUEST_ID_HEADER]: requestId };
            if (route.successStatus === 204)
                return { status: 204, headers };
            headers['content-type'] = JSON_CONTENT_TYPE;
            return { status: route.successStatus, headers, body: result ?? null };
        }
        catch (error) {
            const gatewayError = this.toGatewayError(error, requestId);
            return {
                status: gatewayError.status,
                headers: {
                    ...gatewayError.headers,
                    [request_id_1.REQUEST_ID_HEADER]: requestId,
                    'content-type': problem_1.PROBLEM_CONTENT_TYPE,
                },
                body: (0, problem_1.toProblem)(gatewayError, requestId, pathname),
            };
        }
    }
    async sendWithFailover(instances, pattern, payload, requestId) {
        const candidates = this.options.balancer.order(pattern, instances).slice(0, this.options.maxAttempts);
        const failed = [];
        for (const instance of candidates) {
            try {
                return await this.options.transport.send(instance, pattern, payload, this.options.rpcTimeoutMs);
            }
            catch (error) {
                const safeToRetry = error instanceof types_1.RpcConnectionError && !error.delivered;
                if (!safeToRetry)
                    throw error;
                failed.push(instance.id);
                if (failed.length < candidates.length) {
                    this.logger.warn(`[${requestId}] ${error.message}; failing over to the next instance`);
                }
                else {
                    this.logger.warn(`[${requestId}] all ${failed.length} instance(s) unreachable: ${failed.join(', ')}`);
                    throw error;
                }
            }
        }
        throw new problem_1.GatewayError(500, 'INTERNAL_ERROR', 'No instance attempted');
    }
    toGatewayError(error, requestId) {
        if (error instanceof problem_1.GatewayError)
            return error;
        if (error instanceof types_1.RpcTimeoutError) {
            this.logger.warn(`[${requestId}] ${error.message}`);
            return new problem_1.GatewayError(504, 'UPSTREAM_TIMEOUT', 'The service did not respond in time');
        }
        if (error instanceof types_1.RpcConnectionError) {
            this.logger.error(`[${requestId}] ${error.message}`);
            return new problem_1.GatewayError(502, 'UPSTREAM_UNAVAILABLE', 'The service is unreachable');
        }
        if (error instanceof types_1.RpcPatternNotHandledError) {
            this.logger.error(`[${requestId}] ${error.message}`);
            return new problem_1.GatewayError(502, 'PATTERN_NOT_HANDLED', 'The service cannot handle this operation');
        }
        if (error instanceof types_1.RpcRemoteError) {
            const remote = asRemoteError(error.payload);
            if (remote) {
                return new problem_1.GatewayError(remote.statusCode, remote.code ?? 'UPSTREAM_ERROR', remote.message, {}, remote.details);
            }
            this.logger.error(`[${requestId}] ${error.message}: ${safeStringify(error.payload)}`);
            return new problem_1.GatewayError(502, 'UPSTREAM_ERROR', 'The service failed to process the request');
        }
        this.logger.error(`[${requestId}] unexpected error: ${error?.stack ?? String(error)}`);
        return new problem_1.GatewayError(500, 'INTERNAL_ERROR', 'Unexpected gateway error');
    }
}
exports.GatewayHandler = GatewayHandler;
function asRemoteError(payload) {
    if (typeof payload !== 'object' || payload === null)
        return undefined;
    const p = payload;
    const statusCode = p.statusCode;
    if (typeof statusCode !== 'number' || !Number.isInteger(statusCode) || statusCode < 400 || statusCode > 599) {
        return undefined;
    }
    return {
        statusCode,
        message: typeof p.message === 'string' ? p.message : 'Request failed',
        code: typeof p.code === 'string' ? p.code : undefined,
        details: p.details,
    };
}
function parseUrl(url) {
    const queryStart = url.indexOf('?');
    const pathname = queryStart === -1 ? url : url.slice(0, queryStart);
    const query = {};
    if (queryStart !== -1) {
        for (const [key, value] of new URLSearchParams(url.slice(queryStart + 1))) {
            const existing = query[key];
            query[key] = existing === undefined ? value : [...[].concat(existing), value];
        }
    }
    return { pathname, query };
}
function idempotencyKey(headers) {
    const value = headers['idempotency-key'];
    return typeof value === 'string' && value !== '' && value.length <= MAX_IDEMPOTENCY_KEY_LENGTH
        ? { idempotencyKey: value }
        : {};
}
function safeStringify(value) {
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
function firstHeader(value) {
    return typeof value === 'string' ? value : value?.[0];
}
//# sourceMappingURL=gateway-handler.js.map