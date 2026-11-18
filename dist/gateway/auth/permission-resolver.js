"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CachingPermissionResolver = exports.RpcPermissionResolver = exports.AUTHZ_PATTERN = void 0;
exports.parsePermissions = parsePermissions;
exports.AUTHZ_PATTERN = 'identity.authz.permissions';
class RpcPermissionResolver {
    options;
    constructor(options) {
        this.options = options;
    }
    async permissionsOf(userId, requestId) {
        const { discovery, transport, balancer, timeoutMs, maxAttempts, project } = this.options;
        const pattern = this.options.pattern ?? exports.AUTHZ_PATTERN;
        const instances = await discovery.resolve(pattern);
        if (instances.length === 0)
            throw new Error(`No instance handles "${pattern}"`);
        const payload = {
            params: { id: userId },
            query: {},
            meta: { requestId, operationId: pattern, project },
        };
        let lastError;
        const candidates = balancer.order(pattern, instances).slice(0, maxAttempts);
        for (const instance of candidates) {
            try {
                return parsePermissions(await transport.send(instance, pattern, payload, timeoutMs));
            }
            catch (error) {
                lastError = error;
            }
        }
        throw lastError;
    }
}
exports.RpcPermissionResolver = RpcPermissionResolver;
function parsePermissions(result) {
    const permissions = result?.permissions;
    if (!Array.isArray(permissions) || permissions.some((key) => typeof key !== 'string')) {
        throw new Error('Invalid permissions response');
    }
    return new Set(permissions);
}
class CachingPermissionResolver {
    inner;
    options;
    entries = new Map();
    inflight = new Map();
    now;
    constructor(inner, options) {
        this.inner = inner;
        this.options = options;
        this.now = options.now ?? Date.now;
    }
    async permissionsOf(userId, requestId) {
        const hit = this.entries.get(userId);
        if (hit) {
            if (hit.expiresAt > this.now())
                return hit.value;
            this.entries.delete(userId);
        }
        const pending = this.inflight.get(userId);
        if (pending)
            return pending;
        const lookup = this.inner
            .permissionsOf(userId, requestId)
            .then((value) => {
            this.store(userId, value);
            return value;
        })
            .finally(() => this.inflight.delete(userId));
        this.inflight.set(userId, lookup);
        return lookup;
    }
    store(userId, value) {
        if (this.entries.size >= this.options.maxEntries && !this.entries.has(userId)) {
            const oldest = this.entries.keys().next().value;
            if (oldest !== undefined)
                this.entries.delete(oldest);
        }
        this.entries.set(userId, { value, expiresAt: this.now() + this.options.ttlMs });
    }
}
exports.CachingPermissionResolver = CachingPermissionResolver;
//# sourceMappingURL=permission-resolver.js.map