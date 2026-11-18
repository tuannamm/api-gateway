import type { Instance } from '../discovery/types';
export interface RpcTransport {
    send(instance: Instance, pattern: string, payload: unknown, timeoutMs: number): Promise<unknown>;
    close(): Promise<void>;
}
export declare class RpcTimeoutError extends Error {
    readonly pattern: string;
    readonly instance: Instance;
    readonly timeoutMs: number;
    constructor(pattern: string, instance: Instance, timeoutMs: number);
}
export declare class RpcConnectionError extends Error {
    readonly instance: Instance;
    readonly cause: unknown;
    readonly delivered: boolean;
    constructor(instance: Instance, cause: unknown, delivered: boolean);
}
export declare class RpcPatternNotHandledError extends Error {
    readonly pattern: string;
    readonly instance: Instance;
    constructor(pattern: string, instance: Instance);
}
export declare class RpcRemoteError extends Error {
    readonly pattern: string;
    readonly instance: Instance;
    readonly payload: unknown;
    constructor(pattern: string, instance: Instance, payload: unknown);
}
