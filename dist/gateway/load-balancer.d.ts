import type { Instance } from './discovery/types';
export interface LoadBalancer {
    order(key: string, instances: readonly Instance[]): Instance[];
}
export declare class RoundRobinBalancer implements LoadBalancer {
    private readonly counters;
    order(key: string, instances: readonly Instance[]): Instance[];
}
