"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TcpTransport = void 0;
const node_util_1 = require("node:util");
const microservices_1 = require("@nestjs/microservices");
const rxjs_1 = require("rxjs");
const types_1 = require("./types");
const NO_MESSAGE_HANDLER = 'There is no matching message handler defined in the remote service.';
const NOT_DELIVERED_CODES = new Set(['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN']);
const MAYBE_DELIVERED_CODES = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT']);
class TcpTransport {
    clients = new Map();
    async send(instance, pattern, payload, timeoutMs) {
        const key = `${instance.host}:${instance.port}`;
        const client = this.clientFor(key, instance);
        try {
            return await (0, rxjs_1.firstValueFrom)(client.send(pattern, payload).pipe((0, rxjs_1.timeout)(timeoutMs)), {
                defaultValue: undefined,
            });
        }
        catch (error) {
            if (error instanceof rxjs_1.TimeoutError) {
                throw new types_1.RpcTimeoutError(pattern, instance, timeoutMs);
            }
            const connection = classifyConnectionError(error);
            if (connection) {
                await this.evict(key);
                throw new types_1.RpcConnectionError(instance, error, connection === 'maybe-delivered');
            }
            if (error === NO_MESSAGE_HANDLER) {
                throw new types_1.RpcPatternNotHandledError(pattern, instance);
            }
            throw new types_1.RpcRemoteError(pattern, instance, error);
        }
    }
    async close() {
        const keys = [...this.clients.keys()];
        await Promise.all(keys.map((key) => this.evict(key)));
    }
    get poolSize() {
        return this.clients.size;
    }
    clientFor(key, instance) {
        let client = this.clients.get(key);
        if (!client) {
            client = microservices_1.ClientProxyFactory.create({
                transport: microservices_1.Transport.TCP,
                options: { host: instance.host, port: instance.port },
            });
            this.clients.set(key, client);
        }
        return client;
    }
    async evict(key) {
        const client = this.clients.get(key);
        this.clients.delete(key);
        try {
            await client?.close();
        }
        catch {
        }
    }
}
exports.TcpTransport = TcpTransport;
function classifyConnectionError(error) {
    if (!node_util_1.types.isNativeError(error))
        return undefined;
    const code = error.code;
    if (code !== undefined && NOT_DELIVERED_CODES.has(code))
        return 'not-delivered';
    if (code !== undefined && MAYBE_DELIVERED_CODES.has(code))
        return 'maybe-delivered';
    if (error.message === 'Connection closed')
        return 'maybe-delivered';
    return undefined;
}
//# sourceMappingURL=tcp-transport.js.map