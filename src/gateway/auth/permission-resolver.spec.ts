import type { GatewayRequest } from '../contracts';
import type { Instance, ServiceDiscovery } from '../discovery/types';
import { RoundRobinBalancer } from '../load-balancer';
import type { RpcTransport } from '../transport/types';
import {
  AUTHZ_PATTERN,
  CachingPermissionResolver,
  RpcPermissionResolver,
  parsePermissions,
  type PermissionResolver,
} from './permission-resolver';

const a: Instance = { id: 'a', service: 'identity', host: '127.0.0.1', port: 1 };
const b: Instance = { id: 'b', service: 'identity', host: '127.0.0.1', port: 2 };

function rpc(send: RpcTransport['send'], instances: Instance[] = [a, b], maxAttempts = 2) {
  const discovery: ServiceDiscovery = { resolve: async () => instances };
  return new RpcPermissionResolver({
    project: 'identity',
    discovery,
    transport: { send, close: async () => undefined },
    balancer: new RoundRobinBalancer(),
    timeoutMs: 500,
    maxAttempts,
  });
}

describe('RpcPermissionResolver', () => {
  it('asks the internal pattern with only the verified user id', async () => {
    const send = jest.fn(async (..._args: unknown[]) => ({ userId: 'u1', role: 'user', permissions: ['users:read'] }));
    const granted = await rpc(send as never).permissionsOf('u1', 'req-1');

    expect([...granted]).toEqual(['users:read']);
    const [, pattern, payload, timeout] = send.mock.calls[0] as [Instance, string, GatewayRequest, number];
    expect(pattern).toBe(AUTHZ_PATTERN);
    expect(timeout).toBe(500);
    expect(payload).toEqual({
      params: { id: 'u1' },
      query: {},
      meta: { requestId: 'req-1', operationId: AUTHZ_PATTERN, project: 'identity' },
    });
  });

  it('tries the next instance on failure (read-only, safe to retry)', async () => {
    const send = jest
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({ permissions: ['x:y'] });
    expect([...(await rpc(send).permissionsOf('u', 'r'))]).toEqual(['x:y']);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('throws when every attempt fails or nobody handles the pattern', async () => {
    await expect(rpc(jest.fn().mockRejectedValue(new Error('down'))).permissionsOf('u', 'r')).rejects.toThrow('down');
    await expect(rpc(jest.fn(), []).permissionsOf('u', 'r')).rejects.toThrow(/No instance/);
  });

  it.each([null, {}, { permissions: 'users:read' }, { permissions: ['ok', 1] }])(
    'rejects a malformed response %p',
    (response) => {
      expect(() => parsePermissions(response)).toThrow('Invalid permissions response');
    },
  );
});

describe('CachingPermissionResolver', () => {
  function setup(ttlMs = 1000, maxEntries = 2) {
    let now = 0;
    const calls: string[] = [];
    let fail = false;
    const inner: PermissionResolver = {
      permissionsOf: async (id) => {
        calls.push(id);
        await Promise.resolve();
        if (fail) throw new Error('down');
        return new Set([`${id}:read`]);
      },
    };
    const cache = new CachingPermissionResolver(inner, { ttlMs, maxEntries, now: () => now });
    return {
      cache,
      calls,
      advance: (ms: number) => (now += ms),
      setFail: (value: boolean) => (fail = value),
    };
  }

  it('serves repeated lookups from the cache until the TTL expires', async () => {
    const { cache, calls, advance } = setup();
    await cache.permissionsOf('u1', 'r');
    await cache.permissionsOf('u1', 'r');
    expect(calls).toEqual(['u1']);
    advance(1001);
    await cache.permissionsOf('u1', 'r');
    expect(calls).toEqual(['u1', 'u1']);
  });

  it('shares one lookup between concurrent requests (single-flight)', async () => {
    const { cache, calls } = setup();
    await Promise.all([cache.permissionsOf('u1', 'a'), cache.permissionsOf('u1', 'b'), cache.permissionsOf('u1', 'c')]);
    expect(calls).toEqual(['u1']);
  });

  it('does not cache failures', async () => {
    const { cache, calls, setFail } = setup();
    setFail(true);
    await expect(cache.permissionsOf('u1', 'r')).rejects.toThrow('down');
    setFail(false);
    expect([...(await cache.permissionsOf('u1', 'r'))]).toEqual(['u1:read']);
    expect(calls).toEqual(['u1', 'u1']);
  });

  it('keeps users separate and evicts the oldest entry when full', async () => {
    const { cache, calls } = setup(1000, 2);
    await cache.permissionsOf('u1', 'r');
    await cache.permissionsOf('u2', 'r');
    await cache.permissionsOf('u3', 'r'); // evicts u1
    await cache.permissionsOf('u2', 'r'); // still cached
    await cache.permissionsOf('u1', 'r'); // looked up again
    expect(calls).toEqual(['u1', 'u2', 'u3', 'u1']);
  });
});
