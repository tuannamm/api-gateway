/**
 * Lỗi của control plane. Cả hai đều xảy ra LÚC KHỞI ĐỘNG (fail-fast):
 * cấu hình sai thì gateway từ chối chạy, thay vì để người dùng gặp lỗi lúc runtime.
 */

/** Biến môi trường thiếu hoặc sai (project không tồn tại, path traversal, ...). */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Spec không hợp lệ. Chứa TOÀN BỘ lỗi tìm được (`issues`) chứ không dừng ở lỗi đầu tiên,
 * để người viết spec sửa một lượt thay vì sửa - chạy - sửa nhiều vòng.
 */
export class SpecValidationError extends Error {
  constructor(
    readonly specPath: string,
    readonly issues: readonly string[],
  ) {
    super(
      `Invalid OpenAPI spec "${specPath}" (${issues.length} issue(s)):\n` +
        issues.map((issue) => `  - ${issue}`).join('\n'),
    );
    this.name = 'SpecValidationError';
  }
}
