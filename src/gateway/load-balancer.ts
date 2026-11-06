import type { Instance } from './discovery/types';

/**
 * Chọn instance cho một request. Trả về THỨ TỰ THỬ chứ không chỉ một instance:
 * phần tử đầu là lựa chọn chính, phần còn lại dùng để failover khi lựa chọn chính
 * chắc chắn không nhận được request (xem GatewayHandler).
 */
export interface LoadBalancer {
  order(key: string, instances: readonly Instance[]): Instance[];
}

/**
 * Round-robin: lần lượt xoay vòng instance chính.
 *
 *   instances [A, B, C]   lần 1 → [A, B, C]   lần 2 → [B, C, A]   lần 3 → [C, A, B]
 *
 * - Bộ đếm RIÊNG cho từng key (project|pattern). Một bộ đếm chung cho mọi pattern
 *   làm phân phối của từng pattern bị lệch: nếu request xen kẽ "user.getById" và
 *   "user.list" với 2 instance, mỗi pattern sẽ luôn rơi vào cùng một instance.
 * - Sắp theo id trước khi xoay, để thứ tự không phụ thuộc thứ tự registry trả về.
 * - Không giữ trạng thái "instance nào đang chết": việc đó là outlier detection /
 *   circuit breaker (Bước 5).
 */
export class RoundRobinBalancer implements LoadBalancer {
  private readonly counters = new Map<string, number>();

  order(key: string, instances: readonly Instance[]): Instance[] {
    if (instances.length <= 1) return [...instances];

    const sorted = [...instances].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const turn = this.counters.get(key) ?? 0;
    // Lưu phần dư thay vì cộng mãi, để bộ đếm không lớn vô hạn.
    this.counters.set(key, (turn + 1) % sorted.length);

    const start = turn % sorted.length;
    return [...sorted.slice(start), ...sorted.slice(0, start)];
  }
}
