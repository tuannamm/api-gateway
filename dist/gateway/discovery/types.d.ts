export interface Instance {
    id: string;
    service: string;
    host: string;
    port: number;
}
export interface ServiceDiscovery {
    resolve(pattern: string): Promise<Instance[]>;
    close?(): void;
}
