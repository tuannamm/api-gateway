/**
 * Ranh giới giữa gateway và Service Registry (project riêng).
 * Gateway chỉ biết interface này; cài đặt là RegistryDiscovery, test dùng bản giả
 * (Dependency Inversion: code cấp cao phụ thuộc abstraction, không phụ thuộc cài đặt cụ thể).
 */

export interface Instance {
  id: string;
  /** Tên service, dùng cho log/metrics/circuit breaker. Gateway KHÔNG dùng để định tuyến. */
  service: string;
  host: string;
  /** Cổng TCP của microservice. */
  port: number;
}

export interface ServiceDiscovery {
  /**
   * Instance healthy đang xử lý `pattern` (= operationId).
   * Mảng rỗng nghĩa là chưa có ai xử lý → gateway trả 503.
   *
   * Không có tham số project: mỗi registry phục vụ đúng MỘT project
   * application, và mỗi gateway chỉ nói chuyện với registry của project mình.
   */
  resolve(pattern: string): Promise<Instance[]>;
  /** Giải phóng tài nguyên (timer poll...) khi gateway tắt. Bản giả trong test có thể bỏ qua. */
  close?(): void;
}
