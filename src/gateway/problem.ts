import { STATUS_CODES } from 'node:http';

/**
 * Lỗi mà gateway sẽ trả cho client. Mọi nhánh lỗi trong data plane đều quy về class này,
 * rồi được chuyển thành body RFC 9457 ở MỘT chỗ duy nhất (toProblem).
 */
export class GatewayError extends Error {
  constructor(
    readonly status: number,
    /** Mã ổn định cho client xử lý bằng code, VD "ROUTE_NOT_FOUND". */
    readonly code: string,
    message: string,
    /** Header bổ sung, VD Allow cho 405. */
    readonly headers: Record<string, string> = {},
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

/**
 * RFC 9457 "Problem Details for HTTP APIs" (content-type application/problem+json).
 * type/title/status/detail/instance là field chuẩn; code/requestId/details là extension member.
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
  requestId: string;
  details?: unknown;
}

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

export function toProblem(error: GatewayError, requestId: string, instance: string): ProblemDetails {
  return {
    // "about:blank" = không có trang tài liệu riêng cho loại lỗi; khi đó title nên là tên chuẩn của status.
    type: 'about:blank',
    title: STATUS_CODES[error.status] ?? 'Error',
    status: error.status,
    detail: error.message,
    instance,
    code: error.code,
    requestId,
    ...(error.details !== undefined && { details: error.details }),
  };
}
