import { FixedWindowRateLimiter, InMemoryFixedWindowStore } from './fixed-window';

const WINDOW = 60_000;
// Mốc căn đúng đầu một cửa sổ để tính toán dễ đọc.
const T0 = 10 * WINDOW;

function make(max = 3, sweepMs?: number) {
  const store = new InMemoryFixedWindowStore(sweepMs);
  return { store, limiter: new FixedWindowRateLimiter(store, { max, windowMs: WINDOW }) };
}

describe('FixedWindowRateLimiter', () => {
  it('allows up to max requests then rejects within the same window', async () => {
    const { limiter } = make(3);
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await limiter.consume('ip', T0 + i));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0]);
  });

  it('resets the counter in the next window', async () => {
    const { limiter } = make(1);
    expect((await limiter.consume('ip', T0)).allowed).toBe(true);
    expect((await limiter.consume('ip', T0 + 1)).allowed).toBe(false);
    expect((await limiter.consume('ip', T0 + WINDOW)).allowed).toBe(true);
  });

  it('counts each key separately', async () => {
    const { limiter } = make(1);
    expect((await limiter.consume('a', T0)).allowed).toBe(true);
    expect((await limiter.consume('b', T0)).allowed).toBe(true);
    expect((await limiter.consume('a', T0)).allowed).toBe(false);
  });

  it('aligns windows to the clock, not to the first request', async () => {
    const { limiter } = make(1);
    // Request đầu ở cuối cửa sổ; 1ms sau đã sang cửa sổ mới nên được tính lại.
    expect((await limiter.consume('ip', T0 + WINDOW - 1)).allowed).toBe(true);
    expect((await limiter.consume('ip', T0 + WINDOW)).allowed).toBe(true);
  });

  it('reports resetAt and retryAfterSec (rounded up, at least 1)', async () => {
    const { limiter } = make(1);
    const r = await limiter.consume('ip', T0 + 59_500);
    expect(r.resetAt).toBe(T0 + WINDOW);
    expect(r.retryAfterSec).toBe(1);
    expect((await limiter.consume('ip', T0 + 1_000)).retryAfterSec).toBe(59);
  });

  it('allows a burst of 2*max across a window boundary (known limitation)', async () => {
    const { limiter } = make(2);
    const results = [
      await limiter.consume('ip', T0 + WINDOW - 2),
      await limiter.consume('ip', T0 + WINDOW - 1),
      await limiter.consume('ip', T0 + WINDOW),
      await limiter.consume('ip', T0 + WINDOW + 1),
    ];
    expect(results.every((r) => r.allowed)).toBe(true);
  });
});

describe('InMemoryFixedWindowStore', () => {
  it('sweeps expired keys but keeps live ones', async () => {
    const { store, limiter } = make(5, 1_000);
    await limiter.consume('old', T0);
    await limiter.consume('live', T0 + WINDOW + 1_500);
    // Lần gọi này kích hoạt sweep: 'old' đã hết hạn, 'live' còn trong cửa sổ.
    await limiter.consume('live', T0 + WINDOW + 3_000);
    expect(store.size).toBe(1);
  });
});
