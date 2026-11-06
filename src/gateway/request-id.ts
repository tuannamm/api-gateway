import { randomUUID } from 'node:crypto';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Giá trị client gửi được chấp nhận nếu ngắn và chỉ gồm ký tự an toàn (không chèn được ký tự lạ vào log). */
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Giữ x-request-id của client nếu hợp lệ (để client tự gắn mã khi cần truy vết),
 * ngược lại sinh mới. Không tin mù quáng giá trị từ client.
 */
export function resolveRequestId(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value !== undefined && VALID_REQUEST_ID.test(value) ? value : randomUUID();
}
