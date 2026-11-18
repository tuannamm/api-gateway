/**
 * Rate limit kiểu FIXED WINDOW.
 *
 * Thời gian chia thành các cửa sổ cố định, căn theo đồng hồ: cửa sổ k phủ [k*windowMs, (k+1)*windowMs).
 * Mỗi key có một bộ đếm cho cửa sổ hiện tại; sang cửa sổ mới thì đếm lại từ 0.
 * Căn theo đồng hồ (không bắt đầu từ request đầu tiên) để mọi instance gateway/Redis tính ra cùng cửa sổ.
 *
 * Nhược điểm của thuật toán: burst ở ranh giới cửa sổ, tối đa 2*max request trong một khoảng ngắn.
 */

/**
 * Nơi lưu bộ đếm. Tách thành interface để sau này thay bằng Redis mà không đụng limiter.
 * Bản Redis tương ứng: INCR `${key}:${windowStart}` rồi PEXPIREAT resetAt.
 */
export interface RateLimitStore {
  /** Tăng bộ đếm của `key` trong cửa sổ bắt đầu lúc `windowStart`, trả về giá trị SAU khi tăng. */
  hit(key: string, windowStart: number, resetAt: number, now: number): Promise<number>;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  /** Số request còn lại trong cửa sổ hiện tại (không âm). */
  remaining: number;
  /** Thời điểm cửa sổ kết thúc (epoch ms). */
  resetAt: number;
  /** Số giây client nên đợi trước khi thử lại (>= 1). */
  retryAfterSec: number;
}

export interface FixedWindowOptions {
  max: number;
  windowMs: number;
}

export class FixedWindowRateLimiter {
  constructor(
    private readonly store: RateLimitStore,
    private readonly options: FixedWindowOptions,
  ) {}

  async consume(key: string, now: number = Date.now()): Promise<RateLimitResult> {
    const { max, windowMs } = this.options;
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const resetAt = windowStart + windowMs;

    const count = await this.store.hit(key, windowStart, resetAt, now);

    return {
      allowed: count <= max,
      limit: max,
      remaining: Math.max(0, max - count),
      resetAt,
      retryAfterSec: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    };
  }
}

interface Entry {
  windowStart: number;
  resetAt: number;
  count: number;
}

/**
 * Lưu trong bộ nhớ process: mỗi key đúng MỘT entry (cửa sổ hiện tại của nó).
 * Gặp request ở cửa sổ mới thì ghi đè entry cũ. Key không quay lại sẽ được dọn lười (lazy sweep)
 * mỗi `sweepIntervalMs`, nên không cần timer nền và không cần close().
 *
 * Mỗi instance gateway đếm riêng: chạy N instance thì giới hạn thực tế là N*max. Cần Redis nếu muốn chính xác.
 */
export class InMemoryFixedWindowStore implements RateLimitStore {
  private readonly entries = new Map<string, Entry>();
  private nextSweepAt = 0;

  constructor(private readonly sweepIntervalMs = 60_000) {}

  hit(key: string, windowStart: number, resetAt: number, now: number): Promise<number> {
    this.sweep(now);
    const entry = this.entries.get(key);
    if (!entry || entry.windowStart !== windowStart) {
      this.entries.set(key, { windowStart, resetAt, count: 1 });
      return Promise.resolve(1);
    }
    entry.count += 1;
    return Promise.resolve(entry.count);
  }

  /** Số key đang giữ (dùng cho test). */
  get size(): number {
    return this.entries.size;
  }

  private sweep(now: number): void {
    if (now < this.nextSweepAt) return;
    this.nextSweepAt = now + this.sweepIntervalMs;
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
    }
  }
}
