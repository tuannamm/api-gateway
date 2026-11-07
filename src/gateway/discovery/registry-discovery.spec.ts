import { RegistryDiscovery } from './registry-discovery';

/** fetch giả: mỗi lần gọi lấy phản hồi tiếp theo trong hàng đợi, ghi lại header đã gửi. */
function fakeFetch(...responses: Array<Response | Error>) {
  const calls: Array<{ url: string; ifNoneMatch?: string }> = [];
  const fn = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(url), ifNoneMatch: headers['if-none-match'] });
    const next = responses.shift();
    if (!next) throw new Error('no more fake responses');
    if (next instanceof Error) throw next;
    return next;
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const snapshot = (version: number, instances: unknown[], etag = `"boot-${version}"`) =>
  new Response(JSON.stringify({ project: 'example', version, instances }), {
    status: 200,
    headers: { 'content-type': 'application/json', etag },
  });
const notModified = () => new Response(null, { status: 304 });

const echo1 = { id: 'echo-1', service: 'echo', host: '127.0.0.1', port: 4001, patterns: ['user.getById', 'user.list'] };
const echo2 = { id: 'echo-2', service: 'echo', host: '127.0.0.1', port: 4002, patterns: ['user.getById'] };

function create(fetchFn: typeof fetch) {
  const logger = { log: jest.fn(), warn: jest.fn() };
  const discovery = new RegistryDiscovery({
    registryUrl: 'http://registry:8500/',
    project: 'example',
    pollIntervalMs: 3_000,
    fetch: fetchFn,
    logger,
  });
  return { discovery, logger };
}

describe('RegistryDiscovery', () => {
  afterEach(() => jest.useRealTimers());

  it('loads the snapshot and resolves instances by pattern', async () => {
    const { fn, calls } = fakeFetch(snapshot(1, [echo1, echo2]));
    const { discovery } = create(fn);

    expect(await discovery.refresh()).toBe('changed');

    expect(calls[0].url).toBe('http://registry:8500/v1/projects/example/snapshot');
    expect((await discovery.resolve('example', 'user.getById')).map((i) => i.id)).toEqual(['echo-1', 'echo-2']);
    expect(await discovery.resolve('example', 'user.list')).toEqual([
      { id: 'echo-1', service: 'echo', host: '127.0.0.1', port: 4001 },
    ]);
    expect(await discovery.resolve('example', 'auth.login')).toEqual([]);
    expect(await discovery.resolve('other-project', 'user.list')).toEqual([]);
    expect(discovery.patterns()).toEqual(['user.getById', 'user.list']);
  });

  it('sends the last ETag in If-None-Match and keeps the table on 304', async () => {
    const { fn, calls } = fakeFetch(snapshot(1, [echo1]), notModified());
    const { discovery } = create(fn);
    await discovery.refresh();

    expect(await discovery.refresh()).toBe('unchanged');

    expect(calls[0].ifNoneMatch).toBeUndefined();
    expect(calls[1].ifNoneMatch).toBe('"boot-1"');
    expect(await discovery.resolve('example', 'user.list')).toHaveLength(1);
  });

  it('replaces the table when the snapshot changes and notifies listeners', async () => {
    const { fn } = fakeFetch(snapshot(1, [echo1, echo2]), snapshot(2, [echo2]));
    const { discovery } = create(fn);
    const listener = jest.fn();
    await discovery.refresh();
    discovery.onChange(listener);

    await discovery.refresh();

    expect((await discovery.resolve('example', 'user.getById')).map((i) => i.id)).toEqual(['echo-2']);
    expect(await discovery.resolve('example', 'user.list')).toEqual([]);
    expect(listener).toHaveBeenCalledWith(['user.getById']);
  });

  it('keeps the last snapshot when the registry fails (stale-on-error) and logs only on state changes', async () => {
    const { fn } = fakeFetch(
      snapshot(1, [echo1]),
      new Error('ECONNREFUSED'),
      new Error('ECONNREFUSED'),
      new Response('boom', { status: 500 }),
      notModified(),
    );
    const { discovery, logger } = create(fn);
    await discovery.refresh();

    expect(await discovery.refresh()).toBe('failed');
    expect(await discovery.refresh()).toBe('failed');
    expect(await discovery.refresh()).toBe('failed');

    expect(await discovery.resolve('example', 'user.list')).toHaveLength(1); // vẫn còn bảng cũ
    expect(logger.warn).toHaveBeenCalledTimes(1); // chỉ log lúc chuyển sang lỗi, không log mỗi lần
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('keeping the last snapshot (1 instance(s))'));

    expect(await discovery.refresh()).toBe('unchanged');
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('reachable again'));
  });

  it('starts with an empty table when the registry is down, then recovers', async () => {
    jest.useFakeTimers();
    const { fn } = fakeFetch(new Error('ECONNREFUSED'), snapshot(1, [echo1]));
    const { discovery, logger } = create(fn);

    await discovery.start(); // không ném lỗi: gateway vẫn khởi động được

    expect(await discovery.resolve('example', 'user.list')).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('unreachable at startup'));

    await jest.advanceTimersByTimeAsync(3_000); // lần poll kế tiếp

    expect(await discovery.resolve('example', 'user.list')).toHaveLength(1);
    discovery.close();
  });

  it('polls on a chained timer and stops after close()', async () => {
    jest.useFakeTimers();
    const { fn, calls } = fakeFetch(snapshot(1, [echo1]), notModified(), notModified(), notModified());
    const { discovery } = create(fn);

    await discovery.start();
    await jest.advanceTimersByTimeAsync(6_000);
    expect(calls).toHaveLength(3);

    discovery.close();
    await jest.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(3);
  });

  it('treats a body without "instances" as a failure and skips malformed instances', async () => {
    const { fn } = fakeFetch(
      new Response(JSON.stringify({ oops: true }), { status: 200 }),
      snapshot(1, [echo1, { id: 'bad', port: 'x' }]),
    );
    const { discovery, logger } = create(fn);

    expect(await discovery.refresh()).toBe('failed');
    expect(await discovery.refresh()).toBe('changed');

    expect(await discovery.resolve('example', 'user.list')).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith('Ignored 1 malformed instance(s) in the registry snapshot.');
  });

  it('returns a copy so callers cannot mutate the internal table', async () => {
    const { fn } = fakeFetch(snapshot(1, [echo1]));
    const { discovery } = create(fn);
    await discovery.refresh();

    (await discovery.resolve('example', 'user.list')).pop();

    expect(await discovery.resolve('example', 'user.list')).toHaveLength(1);
  });
});
