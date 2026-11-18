export interface GatewayConfig {
    auth?: {
        issuer: string;
        audience: string;
    };
    project: string;
    specsDir: string;
    specPath: string;
    discovery: DiscoveryConfig;
    rpcTimeoutMs: number;
    bodyLimit: number;
    failoverMaxAttempts: number;
    corsOrigins: string[];
    authz: {
        cacheTtlMs: number;
        cacheMaxEntries: number;
    };
    port: number;
}
export interface DiscoveryConfig {
    url: string;
    pollIntervalMs: number;
}
export declare function loadConfig(env?: NodeJS.ProcessEnv, cwd?: string): GatewayConfig;
export declare function listProjects(specsDir: string): string[];
