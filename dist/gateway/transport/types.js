"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RpcRemoteError = exports.RpcPatternNotHandledError = exports.RpcConnectionError = exports.RpcTimeoutError = void 0;
class RpcTimeoutError extends Error {
    pattern;
    instance;
    timeoutMs;
    constructor(pattern, instance, timeoutMs) {
        super(`No response for "${pattern}" from ${describe(instance)} within ${timeoutMs}ms`);
        this.pattern = pattern;
        this.instance = instance;
        this.timeoutMs = timeoutMs;
        this.name = 'RpcTimeoutError';
    }
}
exports.RpcTimeoutError = RpcTimeoutError;
class RpcConnectionError extends Error {
    instance;
    cause;
    delivered;
    constructor(instance, cause, delivered) {
        super(`Cannot reach ${describe(instance)}: ${cause?.message ?? String(cause)}`);
        this.instance = instance;
        this.cause = cause;
        this.delivered = delivered;
        this.name = 'RpcConnectionError';
    }
}
exports.RpcConnectionError = RpcConnectionError;
class RpcPatternNotHandledError extends Error {
    pattern;
    instance;
    constructor(pattern, instance) {
        super(`${describe(instance)} has no handler for pattern "${pattern}"`);
        this.pattern = pattern;
        this.instance = instance;
        this.name = 'RpcPatternNotHandledError';
    }
}
exports.RpcPatternNotHandledError = RpcPatternNotHandledError;
class RpcRemoteError extends Error {
    pattern;
    instance;
    payload;
    constructor(pattern, instance, payload) {
        super(`"${pattern}" failed on ${describe(instance)}`);
        this.pattern = pattern;
        this.instance = instance;
        this.payload = payload;
        this.name = 'RpcRemoteError';
    }
}
exports.RpcRemoteError = RpcRemoteError;
function describe(instance) {
    return `${instance.service}@${instance.host}:${instance.port}`;
}
//# sourceMappingURL=types.js.map