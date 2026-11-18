import type { Instance, ServiceDiscovery } from './types';
export interface RegistryDiscoveryLogger {
    log?(message: string): void;
    warn(message: string): void;
}
export interface RegistryDiscoveryOptions {
    registryUrl: string;
    pollIntervalMs: number;
    requestTimeoutMs?: number;
    fetch?: typeof fetch;
    logger?: RegistryDiscoveryLogger;
}
export type RefreshResult = 'changed' | 'unchanged' | 'failed';
export declare class RegistryDiscovery implements ServiceDiscovery {
    private readonly options;
    private table;
    private etag?;
    private version?;
    private instanceCount;
    private reachable?;
    private timer?;
    private closed;
    private readonly listeners;
    private readonly snapshotUrl;
    private readonly fetchFn;
    private readonly logger;
    constructor(options: RegistryDiscoveryOptions);
    start(): Promise<void>;
    refresh(): Promise<RefreshResult>;
    resolve(pattern: string): Promise<Instance[]>;
    patterns(): string[];
    onChange(listener: (patterns: string[]) => void): void;
    close(): void;
    private schedule;
    private ok;
    private failed;
    private buildTable;
}
