import type { Instance, ServiceDiscovery } from './types';

/**
 * Discovery động: đồng bộ SNAPSHOT của project từ Service Registry ở nền.
 *
 *   timer nền ──GET /v1/projects/:project/snapshot (If-None-Match)──► registry
 *                ◄── 200 + bảng mới  |  304 không đổi  |  lỗi → giữ bảng cũ
 *   request  ──resolve(pattern)──► chỉ đọc RAM, KHÔNG BAO GIỜ chờ registry
 *
 * - Data plane chỉ đọc bộ nhớ: registry chậm/chết không làm request chậm theo.
 * - Stale-on-error (AP): registry lỗi thì dùng tiếp bảng cũ. Bảng hơi cũ (có thể còn instance
 *   vừa chết, failover sẽ cứu) tốt hơn bảng rỗng (mọi request 503).
 * - ETag/304: bảng không đổi thì registry trả 304 không body → poll gần như miễn phí.
 * - Poll bằng setTimeout NỐI TIẾP (xong lần này mới hẹn lần sau), không dùng setInterval:
 *   registry chậm hơn chu kỳ poll thì các lần gọi không chồng lên nhau.
 */

export interface RegistryDiscoveryLogger {
  log?(message: string): void;
  warn(message: string): void;
}

export interface RegistryDiscoveryOptions {
  /** VD "http://localhost:8500". */
  registryUrl: string;
  project: string;
  pollIntervalMs: number;
  /** Thời gian chờ tối đa một lần gọi registry. Mặc định 2000ms. */
  requestTimeoutMs?: number;
  /** Tiêm fetch để test không cần mạng. */
  fetch?: typeof fetch;
  logger?: RegistryDiscoveryLogger;
}

export type RefreshResult = 'changed' | 'unchanged' | 'failed';

interface SnapshotBody {
  version?: unknown;
  instances?: unknown;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 2_000;
const silent: RegistryDiscoveryLogger = { warn: () => undefined };

export class RegistryDiscovery implements ServiceDiscovery {
  /** pattern → instances của project này. Thay NGUYÊN bảng mỗi lần đổi (atomic swap), không sửa tại chỗ. */
  private table = new Map<string, Instance[]>();
  private etag?: string;
  private version?: number;
  private instanceCount = 0;
  /** undefined = chưa gọi lần nào; dùng để chỉ log khi trạng thái ĐỔI (không log mỗi 3s). */
  private reachable?: boolean;
  private timer?: NodeJS.Timeout;
  private closed = false;
  private readonly listeners: Array<(patterns: string[]) => void> = [];
  private readonly snapshotUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly logger: RegistryDiscoveryLogger;

  constructor(private readonly options: RegistryDiscoveryOptions) {
    const base = options.registryUrl.replace(/\/+$/, '');
    this.snapshotUrl = `${base}/v1/projects/${encodeURIComponent(options.project)}/snapshot`;
    this.fetchFn = options.fetch ?? fetch;
    this.logger = options.logger ?? silent;
  }

  /**
   * Tải snapshot lần đầu rồi bắt đầu poll nền. KHÔNG ném lỗi khi registry chết:
   * gateway vẫn mở cổng (503 cho tới khi đồng bộ được) và tự phục hồi khi registry sống lại.
   */
  async start(): Promise<void> {
    await this.refresh();
    if (this.reachable === false) {
      this.logger.warn(
        `Registry ${this.options.registryUrl} is unreachable at startup; serving 503 until the first snapshot arrives.`,
      );
    }
    this.schedule();
  }

  /** Gọi registry một lần. Public để test (và có thể dùng cho endpoint "refresh" sau này). */
  async refresh(): Promise<RefreshResult> {
    let response: Response;
    try {
      response = await this.fetchFn(this.snapshotUrl, {
        headers: this.etag ? { 'if-none-match': this.etag } : {},
        signal: AbortSignal.timeout(this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      return this.failed((error as Error).message);
    }

    if (response.status === 304) return this.ok('unchanged');
    if (response.status !== 200) return this.failed(`HTTP ${response.status}`);

    let body: SnapshotBody;
    try {
      body = (await response.json()) as SnapshotBody;
    } catch {
      return this.failed('invalid JSON');
    }
    if (!Array.isArray(body?.instances)) return this.failed('snapshot has no "instances" array');

    this.table = this.buildTable(body.instances);
    this.etag = response.headers.get('etag') ?? undefined;
    this.version = typeof body.version === 'number' ? body.version : undefined;
    this.instanceCount = body.instances.length;
    this.ok('changed');
    const patterns = this.patterns();
    for (const listener of this.listeners) listener(patterns);
    return 'changed';
  }

  async resolve(project: string, pattern: string): Promise<Instance[]> {
    if (project !== this.options.project) return [];
    // Bản copy: nơi gọi (load balancer) không sửa được bảng bên trong.
    return [...(this.table.get(pattern) ?? [])];
  }

  /** Các pattern đang có instance. */
  patterns(): string[] {
    return [...this.table.keys()].sort();
  }

  /** Đăng ký nhận thông báo mỗi khi bảng đổi (để log pattern chưa có ai xử lý). */
  onChange(listener: (patterns: string[]) => void): void {
    this.listeners.push(listener);
  }

  /** Dừng poll (graceful shutdown). */
  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
  }

  // ---------------------------------------------------------------------------

  private schedule(): void {
    if (this.closed) return;
    this.timer = setTimeout(() => {
      void this.refresh().finally(() => this.schedule());
    }, this.options.pollIntervalMs);
    // unref: timer poll không giữ process sống khi mọi thứ khác đã tắt.
    this.timer.unref();
  }

  private ok(result: 'changed' | 'unchanged'): RefreshResult {
    if (this.reachable === false) {
      this.logger.log?.(`Registry is reachable again (snapshot version ${this.version ?? '?'}).`);
    }
    if (result === 'changed') {
      this.logger.log?.(
        `Discovery snapshot v${this.version ?? '?'}: ${this.instanceCount} instance(s), ${this.table.size} pattern(s).`,
      );
    }
    this.reachable = true;
    return result;
  }

  /** Giữ bảng cũ (stale-on-error). Chỉ log khi chuyển từ "được" sang "lỗi", tránh log ngập mỗi 3s. */
  private failed(reason: string): RefreshResult {
    if (this.reachable === true) {
      this.logger.warn(
        `Registry unreachable (${reason}); keeping the last snapshot (${this.instanceCount} instance(s)).`,
      );
    }
    this.reachable = false;
    return 'failed';
  }

  /** Dựng bảng pattern → instances. Bản ghi sai hình dạng bị bỏ qua (không tin dữ liệu qua mạng). */
  private buildTable(raw: unknown[]): Map<string, Instance[]> {
    const table = new Map<string, Instance[]>();
    let skipped = 0;
    for (const entry of raw) {
      const e = entry as Partial<Instance> & { patterns?: unknown };
      const valid =
        typeof e?.id === 'string' &&
        typeof e.service === 'string' &&
        typeof e.host === 'string' &&
        Number.isInteger(e.port) &&
        Array.isArray(e.patterns);
      if (!valid) {
        skipped += 1;
        continue;
      }
      const instance: Instance = { id: e.id!, service: e.service!, host: e.host!, port: e.port! };
      for (const pattern of e.patterns as unknown[]) {
        if (typeof pattern !== 'string') continue;
        table.set(pattern, [...(table.get(pattern) ?? []), instance]);
      }
    }
    if (skipped) this.logger.warn(`Ignored ${skipped} malformed instance(s) in the registry snapshot.`);
    return table;
  }
}
