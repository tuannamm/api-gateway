import type { Instance } from '../discovery/types';

/**
 * Cách gateway gửi message xuống service. GatewayHandler chỉ biết interface này;
 * TcpTransport là một cài đặt (sau này có thể thêm RabbitMQ RPC, gRPC... mà không sửa handler).
 */
export interface RpcTransport {
  /** Gửi `payload` với `pattern` tới `instance`, chờ kết quả tối đa `timeoutMs`. */
  send(instance: Instance, pattern: string, payload: unknown, timeoutMs: number): Promise<unknown>;
  /** Đóng mọi kết nối (graceful shutdown). */
  close(): Promise<void>;
}

/**
 * Bốn loại lỗi transport, mỗi loại ứng với một mã HTTP khác nhau.
 * Transport có trách nhiệm PHÂN LOẠI; GatewayHandler có trách nhiệm DỊCH sang HTTP.
 */

/** Service không trả lời kịp → 504. */
export class RpcTimeoutError extends Error {
  constructor(
    readonly pattern: string,
    readonly instance: Instance,
    readonly timeoutMs: number,
  ) {
    super(`No response for "${pattern}" from ${describe(instance)} within ${timeoutMs}ms`);
    this.name = 'RpcTimeoutError';
  }
}

/**
 * Không kết nối được hoặc mất kết nối giữa chừng → 502.
 *
 * `delivered` cho biết request CÓ THỂ đã tới service hay chưa:
 * - false: chắc chắn chưa (VD ECONNREFUSED: chưa mở được kết nối) → gửi sang instance khác là AN TOÀN,
 *   kể cả với POST, vì service chưa hề thấy request.
 * - true: không biết (VD mất kết nối sau khi đã gửi) → service có thể đã xử lý; gửi lại có thể tạo trùng.
 */
export class RpcConnectionError extends Error {
  constructor(
    readonly instance: Instance,
    override readonly cause: unknown,
    readonly delivered: boolean,
  ) {
    super(`Cannot reach ${describe(instance)}: ${(cause as Error)?.message ?? String(cause)}`);
    this.name = 'RpcConnectionError';
  }
}

/** Service đang chạy nhưng không có @MessagePattern cho pattern này (spec và service lệch nhau) → 502. */
export class RpcPatternNotHandledError extends Error {
  constructor(
    readonly pattern: string,
    readonly instance: Instance,
  ) {
    super(`${describe(instance)} has no handler for pattern "${pattern}"`);
    this.name = 'RpcPatternNotHandledError';
  }
}

/** Service xử lý và báo lỗi (RpcException). `payload` là nguyên giá trị service ném ra. */
export class RpcRemoteError extends Error {
  constructor(
    readonly pattern: string,
    readonly instance: Instance,
    readonly payload: unknown,
  ) {
    super(`"${pattern}" failed on ${describe(instance)}`);
    this.name = 'RpcRemoteError';
  }
}

function describe(instance: Instance): string {
  return `${instance.service}@${instance.host}:${instance.port}`;
}
