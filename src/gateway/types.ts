/**
 * Kiểu dữ liệu dùng chung của gateway core.
 * File này KHÔNG import NestJS: core phải chạy được với bất kỳ HTTP framework nào.
 */

/** Các HTTP method mà OpenAPI 3 cho phép khai báo trong một Path Item. */
export const HTTP_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * Một route đã được "biên dịch" từ spec ở control plane.
 * Data plane chỉ đọc cấu trúc này, không bao giờ đọc lại file yml.
 */
export interface RouteDefinition {
  method: HttpMethod;
  /** Path template đúng như trong spec, VD `/users/{id}`. */
  path: string;
  /**
   * Định danh operation (string tự do), đồng thời là `@MessagePattern` của service đích.
   * Spec KHÔNG nói service nào xử lý: gateway hỏi Service Registry "ai xử lý pattern này?"
   * (mỗi service khai báo danh sách pattern của nó khi đăng ký).
   */
  operationId: string;
  /** HTTP status trả về khi service xử lý thành công (lấy từ `responses` trong spec). */
  successStatus: number;
}

/**
 * Kết quả tra cứu RouteTable. Dùng discriminated union (trường `kind`)
 * để nơi gọi buộc phải xử lý đủ mọi trường hợp: TypeScript sẽ báo lỗi nếu bỏ sót.
 */
export type MatchResult =
  | { kind: 'found'; route: RouteDefinition; params: Record<string, string> }
  /** Không có path nào khớp → 404. */
  | { kind: 'not_found' }
  /** Có path khớp nhưng không có method này → 405 + header Allow. */
  | { kind: 'method_not_allowed'; allowed: HttpMethod[] }
  /** Path khớp nhưng tham số chứa percent-encoding hỏng (VD `%E0%A4%A`) → 400. */
  | { kind: 'invalid_path' };
