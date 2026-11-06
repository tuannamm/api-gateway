/**
 * HỢP ĐỒNG giữa gateway và mọi service. Đây là NGUỒN CHUẨN.
 *
 * Service không import file này (app không phụ thuộc app khác), mà giữ một bản copy
 * kèm chú thích trỏ về đây. Đổi hợp đồng thì phải cập nhật bản copy ở các service.
 *
 * Service nhận:
 *   @MessagePattern('user.getById')
 *   getById(@Payload() req: GatewayRequest) { ... }
 *
 * Service báo lỗi nghiệp vụ:
 *   throw new RpcException({ statusCode: 404, message: 'User not found', code: 'USER_NOT_FOUND' } satisfies GatewayRpcError);
 */

/** Danh tính người gọi, gateway lấy từ JWT đã verify (Bước 4). */
export interface GatewayUser {
  sub: string;
  roles: string[];
  [claim: string]: unknown;
}

/** Payload gateway gửi xuống service. Gateway dựng TỪ ĐẦU (allowlist), không chuyển nguyên header. */
export interface GatewayRequest<TBody = unknown> {
  /** Tham số path, VD /users/{id} → { id: "42" }. Đã decode. */
  params: Record<string, string>;
  /** Query string. Key lặp lại (?tag=a&tag=b) thành mảng. */
  query: Record<string, string | string[]>;
  /** Body JSON của request (nếu có). */
  body?: TBody;
  /** Chỉ có khi route cần auth (Bước 4). */
  user?: GatewayUser;
  meta: {
    /** Dùng để log và truyền tiếp (kể cả vào header message RabbitMQ). */
    requestId: string;
    /** = @MessagePattern đang được gọi. */
    operationId: string;
    project: string;
    /** Header Idempotency-Key của client, để service chống xử lý trùng. */
    idempotencyKey?: string;
  };
}

/** Lỗi nghiệp vụ service ném qua RpcException. Gateway dịch thành HTTP problem+json. */
export interface GatewayRpcError {
  /** HTTP status mong muốn, 400–599. */
  statusCode: number;
  message: string;
  /** Mã lỗi ổn định cho client xử lý, VD "USER_NOT_FOUND". */
  code?: string;
  details?: unknown;
}
