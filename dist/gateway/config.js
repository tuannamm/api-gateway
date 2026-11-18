"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
exports.listProjects = listProjects;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const errors_1 = require("./errors");
const DEFAULT_REGISTRY_POLL_MS = 3_000;
const DEFAULT_SPECS_DIR = './specs';
const DEFAULT_SPEC_FILE = 'openapi.yml';
const DEFAULT_RPC_TIMEOUT_MS = 10_000;
const DEFAULT_BODY_LIMIT = 1024 * 1024;
const DEFAULT_FAILOVER_MAX_ATTEMPTS = 3;
const DEFAULT_PORT = 3000;
const DEFAULT_AUTHZ_CACHE_TTL_MS = 30_000;
const DEFAULT_AUTHZ_CACHE_MAX_ENTRIES = 10_000;
const PROJECT_NAME = /^[a-z0-9_-]+$/;
function loadConfig(env = process.env, cwd = process.cwd()) {
    const specsDir = node_path_1.default.resolve(cwd, env.GATEWAY_SPECS_DIR || DEFAULT_SPECS_DIR);
    const specFile = env.GATEWAY_SPEC_FILE || DEFAULT_SPEC_FILE;
    const project = env.GATEWAY_PROJECT?.trim();
    if (!project) {
        throw new errors_1.ConfigError(`GATEWAY_PROJECT is required. ${describeAvailableProjects(specsDir)}`);
    }
    if (!PROJECT_NAME.test(project)) {
        throw new errors_1.ConfigError(`GATEWAY_PROJECT "${project}" is invalid: only lowercase letters, digits, "_" and "-" are allowed.`);
    }
    if (node_path_1.default.basename(specFile) !== specFile || specFile === '..' || specFile === '.') {
        throw new errors_1.ConfigError(`GATEWAY_SPEC_FILE "${specFile}" must be a plain file name, not a path.`);
    }
    const specPath = node_path_1.default.resolve(specsDir, project, specFile);
    if (!isInside(specsDir, specPath)) {
        throw new errors_1.ConfigError(`Resolved spec path escapes ${specsDir}: ${specPath}`);
    }
    if (!(0, node_fs_1.existsSync)(specPath) || !(0, node_fs_1.statSync)(specPath).isFile()) {
        throw new errors_1.ConfigError(`Spec file not found for project "${project}": ${specPath}. ${describeAvailableProjects(specsDir)}`);
    }
    const discovery = loadDiscoveryConfig(env);
    return {
        project,
        auth: loadAuthConfig(env),
        specsDir,
        specPath,
        discovery,
        rpcTimeoutMs: positiveInt(env, 'GATEWAY_RPC_TIMEOUT_MS', DEFAULT_RPC_TIMEOUT_MS),
        bodyLimit: positiveInt(env, 'GATEWAY_BODY_LIMIT', DEFAULT_BODY_LIMIT),
        failoverMaxAttempts: positiveInt(env, 'GATEWAY_FAILOVER_MAX_ATTEMPTS', DEFAULT_FAILOVER_MAX_ATTEMPTS, 10),
        corsOrigins: loadCorsOrigins(env),
        authz: {
            cacheTtlMs: positiveInt(env, 'AUTHZ_CACHE_TTL_MS', DEFAULT_AUTHZ_CACHE_TTL_MS, 3_600_000),
            cacheMaxEntries: positiveInt(env, 'AUTHZ_CACHE_MAX_ENTRIES', DEFAULT_AUTHZ_CACHE_MAX_ENTRIES, 1_000_000),
        },
        port: positiveInt(env, 'PORT', DEFAULT_PORT, 65_535),
    };
}
function loadDiscoveryConfig(env) {
    const urlEnv = env.GATEWAY_REGISTRY_URL?.trim();
    if (!urlEnv) {
        throw new errors_1.ConfigError('GATEWAY_REGISTRY_URL is required (Service Registry, e.g. http://localhost:8500).');
    }
    let url;
    try {
        url = new URL(urlEnv);
    }
    catch {
        throw new errors_1.ConfigError(`GATEWAY_REGISTRY_URL "${urlEnv}" is not a valid URL.`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new errors_1.ConfigError(`GATEWAY_REGISTRY_URL must use http or https, got "${url.protocol}".`);
    }
    if (url.search || url.hash) {
        throw new errors_1.ConfigError('GATEWAY_REGISTRY_URL must not contain a query string or fragment.');
    }
    return {
        url: url.toString().replace(/\/+$/, ''),
        pollIntervalMs: positiveInt(env, 'GATEWAY_REGISTRY_POLL_MS', DEFAULT_REGISTRY_POLL_MS, 60_000),
    };
}
function positiveInt(env, name, fallback, max = Number.MAX_SAFE_INTEGER) {
    const raw = env[name]?.trim();
    if (!raw)
        return fallback;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || value < 1 || value > max) {
        throw new errors_1.ConfigError(`${name} must be an integer between 1 and ${max}, got "${raw}".`);
    }
    return value;
}
function listProjects(specsDir) {
    if (!(0, node_fs_1.existsSync)(specsDir))
        return [];
    return (0, node_fs_1.readdirSync)(specsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && PROJECT_NAME.test(entry.name))
        .map((entry) => entry.name)
        .sort();
}
function describeAvailableProjects(specsDir) {
    const projects = listProjects(specsDir);
    return projects.length
        ? `Available projects in ${specsDir}: ${projects.join(', ')}.`
        : `No projects found in ${specsDir}.`;
}
function isInside(parent, child) {
    const relative = node_path_1.default.relative(parent, child);
    return relative !== '' && !relative.startsWith('..') && !node_path_1.default.isAbsolute(relative);
}
function loadAuthConfig(env) {
    if (!env.KEYCLOAK_ISSUER && !env.KEYCLOAK_AUDIENCE)
        return undefined;
    if (!env.KEYCLOAK_ISSUER || !env.KEYCLOAK_AUDIENCE)
        throw new errors_1.ConfigError('KEYCLOAK_ISSUER and KEYCLOAK_AUDIENCE must be configured together');
    let url;
    try {
        url = new URL(env.KEYCLOAK_ISSUER);
    }
    catch {
        throw new errors_1.ConfigError('KEYCLOAK_ISSUER must be a URL');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
        throw new errors_1.ConfigError('Invalid KEYCLOAK_ISSUER');
    return { issuer: env.KEYCLOAK_ISSUER.replace(/\/+$/, ''), audience: env.KEYCLOAK_AUDIENCE };
}
function loadCorsOrigins(env) {
    const raw = env.GATEWAY_CORS_ORIGINS?.trim();
    if (!raw)
        return [];
    return raw.split(',').map((item) => {
        const value = item.trim();
        let url;
        try {
            url = new URL(value);
        }
        catch {
            throw new errors_1.ConfigError(`GATEWAY_CORS_ORIGINS contains an invalid origin: "${value}".`);
        }
        if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value) {
            throw new errors_1.ConfigError(`GATEWAY_CORS_ORIGINS entries must be exact origins like "http://localhost:3000" (got "${value}").`);
        }
        return url.origin;
    });
}
//# sourceMappingURL=config.js.map