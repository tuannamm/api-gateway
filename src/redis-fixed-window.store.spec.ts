import type { RedisService } from '@lib-infrastructure/redis';
import { FixedWindowRateLimiter } from './gateway/rate-limit/fixed-window';
import { RedisFixedWindowStore } from './redis-fixed-window.store';

/** Redis giả: đủ chuỗi multi().incr().pExpireAt().exec(), lưu đếm + hạn như Redis thật. */
function fakeRedis() {
  const counters = new Map<string, number>();
  const expireAt = new Map<string, number>();
  const redis = {
    client: {
      multi: () => {
        const ops: Array<() => number> = [];
        const chain = {
          incr: (key: string) => (ops.push(() => { counters.set(key, (counters.get(key) ?? 0) + 1); return counters.get(key)!; }), chain),
          pExpireAt: (key: string, at: number) => (ops.push(() => { expireAt.set(key, at); return 1; }), chain),
          exec: async () => ops.map((op) => op()),
        };
        return chain;
      },
    },
  } as unknown as RedisService;
  return { redis, counters, expireAt };
}

describe('RedisFixedWindowStore', () => {
  const WINDOW = 60_000;
  const T0 = 10 * WINDOW;

  it('uses one key per (key, window) and expires it exactly at resetAt', async () => {
    const { redis, expireAt } = fakeRedis();
    const store = new RedisFixedWindowStore(redis, 'gw:p1');
    expect(await store.hit('1.2.3.4', T0, T0 + WINDOW)).toBe(1);
    expect(await store.hit('1.2.3.4', T0, T0 + WINDOW)).toBe(2);
    expect([...expireAt]).toEqual([[`gw:p1:1.2.3.4:${T0}`, T0 + WINDOW]]);
  });

  it('starts a fresh counter in the next window', async () => {
    const { redis, counters } = fakeRedis();
    const store = new RedisFixedWindowStore(redis, 'gw:p1');
    await store.hit('ip', T0, T0 + WINDOW);
    expect(await store.hit('ip', T0 + WINDOW, T0 + 2 * WINDOW)).toBe(1);
    expect(counters.size).toBe(2);
  });

  it('plugs into the limiter and rejects over max', async () => {
    const { redis } = fakeRedis();
    const limiter = new FixedWindowRateLimiter(new RedisFixedWindowStore(redis, 'gw'), { max: 2, windowMs: WINDOW });
    const allowed = [];
    for (let i = 0; i < 3; i++) allowed.push((await limiter.consume('ip', T0 + i)).allowed);
    expect(allowed).toEqual([true, true, false]);
  });
});
