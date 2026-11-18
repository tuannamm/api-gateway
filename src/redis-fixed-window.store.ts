import type { RedisService } from '@lib-infrastructure/redis';
import type { RateLimitStore } from './gateway';

/**
 * Lưu bộ đếm fixed window trong Redis, dùng chung cho mọi instance gateway.
 *
 * Mỗi (key, cửa sổ) là MỘT key Redis: `${prefix}:${key}:${windowStart}`.
 * INCR và PEXPIREAT nằm trong cùng MULTI nên chạy nguyên tử: không thể có key đã tăng mà chưa có TTL
 * (sẽ sống mãi nếu process chết giữa hai lệnh). PEXPIREAT đặt đúng `resetAt`, nên lặp lại ở mỗi request
 * không làm cửa sổ bị kéo dài. Redis tự xoá key khi cửa sổ kết thúc, không cần sweep.
 */
export class RedisFixedWindowStore implements RateLimitStore {
  constructor(
    private readonly redis: RedisService,
    private readonly prefix: string,
  ) {}

  async hit(key: string, windowStart: number, resetAt: number): Promise<number> {
    const redisKey = `${this.prefix}:${key}:${windowStart}`;
    const [count] = await this.redis.client.multi().incr(redisKey).pExpireAt(redisKey, resetAt).exec();
    return Number(count);
  }
}
