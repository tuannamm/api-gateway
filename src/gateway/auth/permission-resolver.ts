import type { GatewayRequest } from '../contracts';
import type { Instance, ServiceDiscovery } from '../discovery/types';
import type { LoadBalancer } from '../load-balancer';
import type { RpcTransport } from '../transport/types';

/**
 * Nguồn permission của một user. Gateway KHÔNG tin permission do client gửi:
 * chỉ tin kết quả của port này (w-identity), lấy theo `sub` đã được xác minh từ JWT.
 */
export interface PermissionResolver {
  permissionsOf(userId: string, requestId: string): Promise<ReadonlySet<string>>;
}

/** Pattern nội bộ của w-identity; KHÔNG có route HTTP tương ứng trong OpenAPI. */
export const AUTHZ_PATTERN = 'identity.authz.permissions';

export interface RpcPermissionResolverOptions {
  project: string;
  discovery: ServiceDiscovery;
  transport: RpcTransport;
  balancer: LoadBalancer;
  timeoutMs: number;
  /** Số instance tối đa được thử. Đọc quyền là thao tác chỉ đọc nên thử lại sang instance khác là an toàn. */
  maxAttempts: number;
  pattern?: string;
}

/** Hỏi service xác thực/phân quyền qua cùng discovery + transport với request thường. */
export class RpcPermissionResolver implements PermissionResolver {
  constructor(private readonly options: RpcPermissionResolverOptions) {}

  async permissionsOf(userId: string, requestId: string): Promise<ReadonlySet<string>> {
    const { discovery, transport, balancer, timeoutMs, maxAttempts, project } = this.options;
    const pattern = this.options.pattern ?? AUTHZ_PATTERN;
    const instances = await discovery.resolve(pattern);
    if (instances.length === 0) throw new Error(`No instance handles "${pattern}"`);

    const payload: GatewayRequest = {
      params: { id: userId },
      query: {},
      meta: { requestId, operationId: pattern, project },
    };
    let lastError: unknown;
    const candidates: Instance[] = balancer.order(pattern, instances).slice(0, maxAttempts);
    for (const instance of candidates) {
      try {
        return parsePermissions(await transport.send(instance, pattern, payload, timeoutMs));
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
}

/** Kiểm tra hình dạng phản hồi: sai hợp đồng thì coi là lỗi (từ chối), không đoán. */
export function parsePermissions(result: unknown): ReadonlySet<string> {
  const permissions = (result as { permissions?: unknown } | null)?.permissions;
  if (!Array.isArray(permissions) || permissions.some((key) => typeof key !== 'string')) {
    throw new Error('Invalid permissions response');
  }
  return new Set(permissions as string[]);
}

export interface CachingPermissionResolverOptions {
  ttlMs: number;
  maxEntries: number;
  /** Chỉ để test. */
  now?: () => number;
}

/**
 * Cache theo userId có TTL ngắn:
 *  - single-flight: nhiều request cùng user đang chờ chỉ gây MỘT lần tra;
 *  - chỉ cache kết quả thành công (lỗi không bị "nhớ", lần sau thử lại);
 *  - giới hạn số entry, đầy thì bỏ entry cũ nhất.
 * Đổi quyền hoặc khóa tài khoản có hiệu lực sau tối đa một TTL.
 */
export class CachingPermissionResolver implements PermissionResolver {
  private readonly entries = new Map<string, { value: ReadonlySet<string>; expiresAt: number }>();
  private readonly inflight = new Map<string, Promise<ReadonlySet<string>>>();
  private readonly now: () => number;

  constructor(
    private readonly inner: PermissionResolver,
    private readonly options: CachingPermissionResolverOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  async permissionsOf(userId: string, requestId: string): Promise<ReadonlySet<string>> {
    const hit = this.entries.get(userId);
    if (hit) {
      if (hit.expiresAt > this.now()) return hit.value;
      this.entries.delete(userId);
    }
    const pending = this.inflight.get(userId);
    if (pending) return pending;

    const lookup = this.inner
      .permissionsOf(userId, requestId)
      .then((value) => {
        this.store(userId, value);
        return value;
      })
      .finally(() => this.inflight.delete(userId));
    this.inflight.set(userId, lookup);
    return lookup;
  }

  private store(userId: string, value: ReadonlySet<string>) {
    if (this.entries.size >= this.options.maxEntries && !this.entries.has(userId)) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(userId, { value, expiresAt: this.now() + this.options.ttlMs });
  }
}
