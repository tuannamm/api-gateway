/**
 * Ranh giới giữa gateway và Service Registry (project riêng).
 * Gateway chỉ biết interface này; StaticDiscovery hôm nay, HttpRegistryAdapter sau này
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
   * Instance healthy đang xử lý `pattern` (= operationId) trong `project`.
   * Mảng rỗng nghĩa là chưa có ai xử lý → gateway trả 503.
   */
  resolve(project: string, pattern: string): Promise<Instance[]>;
}
