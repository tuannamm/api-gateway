import type { GatewayRequest } from './contracts';
import type { Instance, ServiceDiscovery } from './discovery/types';
import type { LoadBalancer } from './load-balancer';
import { GatewayError, PROBLEM_CONTENT_TYPE, toProblem } from './problem';
import { REQUEST_ID_HEADER, resolveRequestId } from './request-id';
import type { RouteTable } from './route-table';
import {
  RpcConnectionError,
  RpcPatternNotHandledError,
  RpcRemoteError,
  RpcTimeoutError,
  type RpcTransport,
} from './transport/types';

/**
 * DATA PLANE: xử lý một HTTP request từ đầu đến cuối.
 * Không biết gì về NestJS/Fastify: nhận một object thuần, trả một object thuần.
 * Nhờ vậy unit test chỉ cần fake discovery + fake transport, không cần mạng.
 */

export type HeaderMap = Record<string, string | string[] | undefined>;

export interface IncomingRequest {
  method: string;
  /** Path + query, VD "/users/42?active=true". */
  url: string;
  /** Tên header viết thường (Node/Fastify đã chuẩn hoá). */
  headers: HeaderMap;
  body?: unknown;
}

export interface OutgoingResponse {
  status: number;
  headers: Record<string, string>;
  /** undefined → không có body (VD 204). */
  body?: unknown;
}

export interface GatewayLogger {
  warn(message: string): void;
  error(message: string): void;
}

export interface GatewayHandlerOptions {
  project: string;
  routeTable: RouteTable;
  discovery: ServiceDiscovery;
  transport: RpcTransport;
  balancer: LoadBalancer;
  rpcTimeoutMs: number;
  /** Số instance tối đa được thử cho một request (1 = tắt failover). */
  maxAttempts: number;
  logger?: GatewayLogger;
}

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const MAX_IDEMPOTENCY_KEY_LENGTH = 255;
const silentLogger: GatewayLogger = { warn: () => undefined, error: () => undefined };

export class GatewayHandler {
  private readonly logger: GatewayLogger;

  constructor(private readonly options: GatewayHandlerOptions) {
    this.logger = options.logger ?? silentLogger;
  }

  async handle(request: IncomingRequest): Promise<OutgoingResponse> {
    const requestId = resolveRequestId(request.headers[REQUEST_ID_HEADER]);
    const { pathname, query } = parseUrl(request.url);

    try {
      // 1. Route
      const match = this.options.routeTable.match(request.method, pathname);
      switch (match.kind) {
        case 'not_found':
          throw new GatewayError(404, 'ROUTE_NOT_FOUND', `No route for ${request.method} ${pathname}`);
        case 'method_not_allowed':
          throw new GatewayError(
            405,
            'METHOD_NOT_ALLOWED',
            `${request.method} is not allowed on ${pathname}`,
            { allow: match.allowed.map((m) => m.toUpperCase()).join(', ') },
          );
        case 'invalid_path':
          throw new GatewayError(400, 'INVALID_PATH', 'Path contains malformed percent-encoding');
      }
      const { route, params } = match;

      // 2. Payload: dựng từ đầu, chỉ những gì hợp đồng cho phép (allowlist).
      const payload: GatewayRequest = {
        params,
        query,
        ...(request.body !== undefined && { body: request.body }),
        meta: {
          requestId,
          operationId: route.operationId,
          project: this.options.project,
          ...idempotencyKey(request.headers),
        },
      };

      // 3. Ai xử lý pattern này?
      const instances = await this.options.discovery.resolve(this.options.project, route.operationId);
      if (instances.length === 0) {
        this.logger.warn(`[${requestId}] no instance handles pattern "${route.operationId}"`);
        throw new GatewayError(
          503,
          'NO_INSTANCE',
          `No service instance is available for "${route.operationId}"`,
        );
      }
      // 4. Chọn instance (round-robin) và gửi, failover khi chắc chắn chưa gửi được.
      const result = await this.sendWithFailover(instances, route.operationId, payload, requestId);

      // 5. Thành công: status lấy từ spec, vì message RPC không có khái niệm HTTP status.
      const headers: Record<string, string> = { [REQUEST_ID_HEADER]: requestId };
      if (route.successStatus === 204) return { status: 204, headers };
      headers['content-type'] = JSON_CONTENT_TYPE;
      return { status: route.successStatus, headers, body: result ?? null };
    } catch (error) {
      const gatewayError = this.toGatewayError(error, requestId);
      return {
        status: gatewayError.status,
        headers: {
          ...gatewayError.headers,
          [REQUEST_ID_HEADER]: requestId,
          'content-type': PROBLEM_CONTENT_TYPE,
        },
        body: toProblem(gatewayError, requestId, pathname),
      };
    }
  }

  /**
   * Thử lần lượt theo thứ tự load balancer trả về.
   * CHỈ chuyển sang instance kế khi lỗi là RpcConnectionError với delivered === false:
   * request chắc chắn chưa tới service nên gửi lại không thể tạo trùng (kể cả POST).
   * Mọi lỗi khác (timeout, mất kết nối giữa chừng, lỗi từ service) ném ngay: service có thể đã xử lý.
   */
  private async sendWithFailover(
    instances: readonly Instance[],
    pattern: string,
    payload: GatewayRequest,
    requestId: string,
  ): Promise<unknown> {
    const key = `${this.options.project}|${pattern}`;
    const candidates = this.options.balancer.order(key, instances).slice(0, this.options.maxAttempts);
    const failed: string[] = [];

    for (const instance of candidates) {
      try {
        return await this.options.transport.send(instance, pattern, payload, this.options.rpcTimeoutMs);
      } catch (error) {
        const safeToRetry = error instanceof RpcConnectionError && !error.delivered;
        if (!safeToRetry) throw error;
        failed.push(instance.id);
        if (failed.length < candidates.length) {
          this.logger.warn(`[${requestId}] ${error.message}; failing over to the next instance`);
        } else {
          // Hết lượt thử: ném lỗi cuối, toGatewayError sẽ dịch thành 502.
          this.logger.warn(`[${requestId}] all ${failed.length} instance(s) unreachable: ${failed.join(', ')}`);
          throw error;
        }
      }
    }
    // Không tới được đây: candidates luôn có ít nhất một phần tử (đã kiểm tra instances rỗng ở trên).
    throw new GatewayError(500, 'INTERNAL_ERROR', 'No instance attempted');
  }

  /** Dịch MỌI lỗi về GatewayError. Đây là chỗ duy nhất quyết định mã HTTP của lỗi. */
  private toGatewayError(error: unknown, requestId: string): GatewayError {
    if (error instanceof GatewayError) return error;

    if (error instanceof RpcTimeoutError) {
      this.logger.warn(`[${requestId}] ${error.message}`);
      return new GatewayError(504, 'UPSTREAM_TIMEOUT', 'The service did not respond in time');
    }
    if (error instanceof RpcConnectionError) {
      this.logger.error(`[${requestId}] ${error.message}`);
      return new GatewayError(502, 'UPSTREAM_UNAVAILABLE', 'The service is unreachable');
    }
    if (error instanceof RpcPatternNotHandledError) {
      // Spec có route nhưng service không có @MessagePattern tương ứng: lỗi cấu hình, cần log rõ.
      this.logger.error(`[${requestId}] ${error.message}`);
      return new GatewayError(502, 'PATTERN_NOT_HANDLED', 'The service cannot handle this operation');
    }
    if (error instanceof RpcRemoteError) {
      const remote = asRemoteError(error.payload);
      if (remote) {
        return new GatewayError(remote.statusCode, remote.code ?? 'UPSTREAM_ERROR', remote.message, {}, remote.details);
      }
      // Service ném lỗi không theo hợp đồng (VD Error thường → NestJS gửi "Internal server error").
      this.logger.error(`[${requestId}] ${error.message}: ${safeStringify(error.payload)}`);
      return new GatewayError(502, 'UPSTREAM_ERROR', 'The service failed to process the request');
    }

    // Lỗi của chính gateway: không lộ chi tiết cho client, chỉ log.
    this.logger.error(`[${requestId}] unexpected error: ${(error as Error)?.stack ?? String(error)}`);
    return new GatewayError(500, 'INTERNAL_ERROR', 'Unexpected gateway error');
  }
}

/** Kiểm tra payload lỗi có đúng hợp đồng GatewayRpcError không. */
function asRemoteError(
  payload: unknown,
): { statusCode: number; message: string; code?: string; details?: unknown } | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const p = payload as Record<string, unknown>;
  const statusCode = p.statusCode;
  if (typeof statusCode !== 'number' || !Number.isInteger(statusCode) || statusCode < 400 || statusCode > 599) {
    return undefined;
  }
  return {
    statusCode,
    message: typeof p.message === 'string' ? p.message : 'Request failed',
    code: typeof p.code === 'string' ? p.code : undefined,
    details: p.details,
  };
}

function parseUrl(url: string): { pathname: string; query: Record<string, string | string[]> } {
  const queryStart = url.indexOf('?');
  const pathname = queryStart === -1 ? url : url.slice(0, queryStart);
  const query: Record<string, string | string[]> = {};
  if (queryStart !== -1) {
    for (const [key, value] of new URLSearchParams(url.slice(queryStart + 1))) {
      const existing = query[key];
      query[key] = existing === undefined ? value : [...([] as string[]).concat(existing), value];
    }
  }
  return { pathname, query };
}

function idempotencyKey(headers: HeaderMap): { idempotencyKey?: string } {
  const value = headers['idempotency-key'];
  return typeof value === 'string' && value !== '' && value.length <= MAX_IDEMPOTENCY_KEY_LENGTH
    ? { idempotencyKey: value }
    : {};
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
