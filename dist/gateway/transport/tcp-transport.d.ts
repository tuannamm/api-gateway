import type { Instance } from '../discovery/types';
import { type RpcTransport } from './types';
export declare class TcpTransport implements RpcTransport {
    private readonly clients;
    send(instance: Instance, pattern: string, payload: unknown, timeoutMs: number): Promise<unknown>;
    close(): Promise<void>;
    get poolSize(): number;
    private clientFor;
    private evict;
}
