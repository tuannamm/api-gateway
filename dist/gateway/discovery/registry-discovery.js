"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RegistryDiscovery = void 0;
const DEFAULT_REQUEST_TIMEOUT_MS = 2_000;
const silent = { warn: () => undefined };
class RegistryDiscovery {
    options;
    table = new Map();
    etag;
    version;
    instanceCount = 0;
    reachable;
    timer;
    closed = false;
    listeners = [];
    snapshotUrl;
    fetchFn;
    logger;
    constructor(options) {
        this.options = options;
        const base = options.registryUrl.replace(/\/+$/, '');
        this.snapshotUrl = `${base}/v1/snapshot`;
        this.fetchFn = options.fetch ?? fetch;
        this.logger = options.logger ?? silent;
    }
    async start() {
        await this.refresh();
        if (this.reachable === false) {
            this.logger.warn(`Registry ${this.options.registryUrl} is unreachable at startup; serving 503 until the first snapshot arrives.`);
        }
        this.schedule();
    }
    async refresh() {
        let response;
        try {
            response = await this.fetchFn(this.snapshotUrl, {
                headers: this.etag ? { 'if-none-match': this.etag } : {},
                signal: AbortSignal.timeout(this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS),
            });
        }
        catch (error) {
            return this.failed(error.message);
        }
        if (response.status === 304)
            return this.ok('unchanged');
        if (response.status !== 200)
            return this.failed(`HTTP ${response.status}`);
        let body;
        try {
            body = (await response.json());
        }
        catch {
            return this.failed('invalid JSON');
        }
        if (!Array.isArray(body?.instances))
            return this.failed('snapshot has no "instances" array');
        this.table = this.buildTable(body.instances);
        this.etag = response.headers.get('etag') ?? undefined;
        this.version = typeof body.version === 'number' ? body.version : undefined;
        this.instanceCount = body.instances.length;
        this.ok('changed');
        const patterns = this.patterns();
        for (const listener of this.listeners)
            listener(patterns);
        return 'changed';
    }
    async resolve(pattern) {
        return [...(this.table.get(pattern) ?? [])];
    }
    patterns() {
        return [...this.table.keys()].sort();
    }
    onChange(listener) {
        this.listeners.push(listener);
    }
    close() {
        this.closed = true;
        if (this.timer)
            clearTimeout(this.timer);
    }
    schedule() {
        if (this.closed)
            return;
        this.timer = setTimeout(() => {
            void this.refresh().finally(() => this.schedule());
        }, this.options.pollIntervalMs);
        this.timer.unref();
    }
    ok(result) {
        if (this.reachable === false) {
            this.logger.log?.(`Registry is reachable again (snapshot version ${this.version ?? '?'}).`);
        }
        if (result === 'changed') {
            this.logger.log?.(`Discovery snapshot v${this.version ?? '?'}: ${this.instanceCount} instance(s), ${this.table.size} pattern(s).`);
        }
        this.reachable = true;
        return result;
    }
    failed(reason) {
        if (this.reachable === true) {
            this.logger.warn(`Registry unreachable (${reason}); keeping the last snapshot (${this.instanceCount} instance(s)).`);
        }
        this.reachable = false;
        return 'failed';
    }
    buildTable(raw) {
        const table = new Map();
        let skipped = 0;
        for (const entry of raw) {
            const e = entry;
            const valid = typeof e?.id === 'string' &&
                typeof e.service === 'string' &&
                typeof e.host === 'string' &&
                Number.isInteger(e.port) &&
                Array.isArray(e.patterns);
            if (!valid) {
                skipped += 1;
                continue;
            }
            const instance = { id: e.id, service: e.service, host: e.host, port: e.port };
            for (const pattern of e.patterns) {
                if (typeof pattern !== 'string')
                    continue;
                table.set(pattern, [...(table.get(pattern) ?? []), instance]);
            }
        }
        if (skipped)
            this.logger.warn(`Ignored ${skipped} malformed instance(s) in the registry snapshot.`);
        return table;
    }
}
exports.RegistryDiscovery = RegistryDiscovery;
//# sourceMappingURL=registry-discovery.js.map