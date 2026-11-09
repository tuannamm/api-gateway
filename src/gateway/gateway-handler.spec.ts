import type { GatewayRequest } from './contracts';
import type { Instance, ServiceDiscovery } from './discovery/types';
import { GatewayHandler, type GatewayLogger, type IncomingRequest } from './gateway-handler';
import { RoundRobinBalancer } from './load-balancer';
import { RouteTable } from './route-table';
import {
  RpcConnectionError,
  RpcPatternNotHandledError,
  RpcRemoteError,
  RpcTimeoutError,
  type RpcTransport,
} from './transport/types';
import type { RouteDefinition } from './types';

const instance: Instance = { id: 'user-1', service: 'user', host: '127.0.0.1', port: 4001 };

const routes: RouteDefinition[] = [
  { method: 'get', path: '/users/{id}', operationId: 'user.getById', successStatus: 200, requiresAuth: false },
  { method: 'post', path: '/users', operationId: 'user.create', successStatus: 201, requiresAuth: false },
  { method: 'delete', path: '/users/{id}', operationId: 'user.remove', successStatus: 204, requiresAuth: false },
  { method: 'get', path: '/orphans', operationId: 'orphan.list', successStatus: 200, requiresAuth: false },
];

type Behaviour = (pattern: string, payload: GatewayRequest, instance: Instance) => unknown;

/** Discovery giả: mọi pattern đều có các instance cho trước, trừ "orphan.list". */
function fakeDiscovery(instances: Instance[]): ServiceDiscovery {
  return { resolve: async (pattern) => (pattern === 'orphan.list' ? [] : [...instances]) };
}

/** Transport giả: ghi lại lần gọi, trả kết quả hoặc ném lỗi tuỳ test. */
function fakeTransport(behaviour: Behaviour) {
  const calls: { instance: Instance; pattern: string; payload: GatewayRequest; timeoutMs: number }[] = [];
  const transport: RpcTransport = {
    send: async (inst, pattern, payload, timeoutMs) => {
      calls.push({ instance: inst, pattern, payload: payload as GatewayRequest, timeoutMs });
      return behaviour(pattern, payload as GatewayRequest, inst);
    },
    close: async () => undefined,
  };
  return { transport, calls };
}

function setup(
  behaviour: Behaviour = () => ({ ok: true }),
  { instances = [instance], maxAttempts = 3 }: { instances?: Instance[]; maxAttempts?: number } = {},
) {
  const { transport, calls } = fakeTransport(behaviour);
  const logs: string[] = [];
  const logger: GatewayLogger = { warn: (m) => logs.push(`warn ${m}`), error: (m) => logs.push(`error ${m}`) };
  const handler = new GatewayHandler({
    project: 'shop',
    routeTable: RouteTable.from(routes),
    discovery: fakeDiscovery(instances),
    transport,
    balancer: new RoundRobinBalancer(),
    rpcTimeoutMs: 1234,
    maxAttempts,
    logger,
  });
  const handle = (req: Partial<IncomingRequest>) =>
    handler.handle({ method: 'GET', url: '/', headers: {}, ...req });
  return { handle, calls, logs };
}

describe('GatewayHandler: success path', () => {
  it('sends the operationId as the pattern with an allowlisted payload', async () => {
    const { handle, calls } = setup();

    await handle({
      method: 'POST',
      url: '/users?tag=a&tag=b&page=2',
      headers: { 'x-request-id': 'req-1', 'idempotency-key': 'idem-9', authorization: 'Bearer secret', 'x-user-id': 'admin' },
      body: { name: 'Nam' },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].instance).toBe(instance);
    expect(calls[0].pattern).toBe('user.create');
    expect(calls[0].timeoutMs).toBe(1234);
    expect(calls[0].payload).toEqual({
      params: {},
      query: { tag: ['a', 'b'], page: '2' },
      body: { name: 'Nam' },
      meta: { requestId: 'req-1', operationId: 'user.create', project: 'shop', idempotencyKey: 'idem-9' },
    });
    // Header của client (kể cả danh tính giả) KHÔNG lọt xuống service.
    expect(JSON.stringify(calls[0].payload)).not.toMatch(/secret|admin/);
  });

  it('returns the success status declared in the spec, with the request id', async () => {
    const { handle } = setup(() => ({ id: 1 }));
    const res = await handle({ method: 'POST', url: '/users', headers: { 'x-request-id': 'req-2' } });

    expect(res).toEqual({
      status: 201,
      headers: { 'x-request-id': 'req-2', 'content-type': 'application/json; charset=utf-8' },
      body: { id: 1 },
    });
  });

  it('passes decoded path params', async () => {
    const { handle, calls } = setup();
    await handle({ url: '/users/Nguy%E1%BB%85n' });
    expect(calls[0].payload.params).toEqual({ id: 'Nguyễn' });
  });

  it('returns 204 without a body', async () => {
    const { handle } = setup(() => 'ignored');
    const res = await handle({ method: 'DELETE', url: '/users/1' });
    expect(res.status).toBe(204);
    expect(res.body).toBeUndefined();
    expect(res.headers['content-type']).toBeUndefined();
  });

  it('turns an undefined result into a JSON null body', async () => {
    const { handle } = setup(() => undefined);
    expect((await handle({ url: '/users/1' })).body).toBeNull();
  });

  it('generates a request id when the client sends none', async () => {
    const { handle, calls } = setup();
    const res = await handle({ url: '/users/1' });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls[0].payload.meta.requestId).toBe(res.headers['x-request-id']);
  });

  it('ignores an over-long Idempotency-Key', async () => {
    const { handle, calls } = setup();
    await handle({ url: '/users/1', headers: { 'idempotency-key': 'k'.repeat(256) } });
    expect(calls[0].payload.meta.idempotencyKey).toBeUndefined();
  });
});

describe('GatewayHandler: error mapping (RFC 9457)', () => {
  async function expectProblem(
    res: Awaited<ReturnType<ReturnType<typeof setup>['handle']>>,
    status: number,
    code: string,
  ) {
    expect(res.status).toBe(status);
    expect(res.headers['content-type']).toBe('application/problem+json');
    expect(res.body).toMatchObject({ type: 'about:blank', status, code, requestId: res.headers['x-request-id'] });
  }

  it('404 when no route matches, without calling any service', async () => {
    const { handle, calls } = setup();
    const res = await handle({ url: '/nope?x=1' });
    await expectProblem(res, 404, 'ROUTE_NOT_FOUND');
    expect(res.body).toMatchObject({ instance: '/nope' });
    expect(calls).toHaveLength(0);
  });

  it('405 with an Allow header', async () => {
    const { handle } = setup();
    const res = await handle({ method: 'PATCH', url: '/users/1' });
    await expectProblem(res, 405, 'METHOD_NOT_ALLOWED');
    expect(res.headers.allow).toBe('DELETE, GET');
  });

  it('400 for malformed percent-encoding', async () => {
    const { handle } = setup();
    await expectProblem(await handle({ url: '/users/%E0%A4%A' }), 400, 'INVALID_PATH');
  });

  it('503 when no instance handles the pattern (and logs it)', async () => {
    const { handle, calls, logs } = setup();
    await expectProblem(await handle({ url: '/orphans' }), 503, 'NO_INSTANCE');
    expect(calls).toHaveLength(0);
    expect(logs.join()).toContain('orphan.list');
  });

  it('504 on timeout', async () => {
    const { handle } = setup((pattern) => {
      throw new RpcTimeoutError(pattern, instance, 1234);
    });
    await expectProblem(await handle({ url: '/users/1' }), 504, 'UPSTREAM_TIMEOUT');
  });

  it('502 when the service is unreachable', async () => {
    const { handle } = setup(() => {
      throw new RpcConnectionError(instance, new Error('connect ECONNREFUSED'), false);
    });
    await expectProblem(await handle({ url: '/users/1' }), 502, 'UPSTREAM_UNAVAILABLE');
  });

  it('502 when the service has no handler for the pattern (and logs it)', async () => {
    const { handle, logs } = setup((pattern) => {
      throw new RpcPatternNotHandledError(pattern, instance);
    });
    await expectProblem(await handle({ url: '/users/1' }), 502, 'PATTERN_NOT_HANDLED');
    expect(logs.join()).toContain('no handler for pattern "user.getById"');
  });

  it('uses status, code, message and details from a contract-compliant service error', async () => {
    const { handle } = setup((pattern) => {
      throw new RpcRemoteError(pattern, instance, {
        statusCode: 409,
        message: 'Email taken',
        code: 'EMAIL_TAKEN',
        details: { field: 'email' },
      });
    });
    const res = await handle({ url: '/users/1' });
    await expectProblem(res, 409, 'EMAIL_TAKEN');
    expect(res.body).toMatchObject({ detail: 'Email taken', details: { field: 'email' } });
  });

  it.each([
    ['NestJS default for a plain Error', { status: 'error', message: 'Internal server error' }],
    ['statusCode out of range', { statusCode: 200, message: 'ok?' }],
    ['a string', 'boom'],
  ])('502 UPSTREAM_ERROR for a non-contract service error (%s)', async (_label, payload) => {
    const { handle } = setup((pattern) => {
      throw new RpcRemoteError(pattern, instance, payload);
    });
    await expectProblem(await handle({ url: '/users/1' }), 502, 'UPSTREAM_ERROR');
  });

  it('500 for unexpected gateway errors, without leaking details', async () => {
    const { handle, logs } = setup(() => {
      throw new TypeError('secret internal detail');
    });
    const res = await handle({ url: '/users/1' });
    await expectProblem(res, 500, 'INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('secret internal detail');
    expect(logs.join()).toContain('secret internal detail');
  });
});

describe('GatewayHandler: load balancing and failover', () => {
  const i1: Instance = { id: 'user-1', service: 'user', host: '127.0.0.1', port: 4001 };
  const i2: Instance = { id: 'user-2', service: 'user', host: '127.0.0.1', port: 4002 };
  const i3: Instance = { id: 'user-3', service: 'user', host: '127.0.0.1', port: 4003 };

  /** Lỗi "chưa kết nối được" (an toàn để thử instance khác) hoặc "đứt giữa chừng" (không an toàn). */
  const refused = (inst: Instance) => new RpcConnectionError(inst, new Error('connect ECONNREFUSED'), false);
  const reset = (inst: Instance) => new RpcConnectionError(inst, new Error('read ECONNRESET'), true);

  it('spreads requests across instances in turn', async () => {
    const { handle, calls } = setup(undefined, { instances: [i1, i2] });
    for (let n = 0; n < 4; n++) await handle({ url: '/users/1' });
    expect(calls.map((c) => c.instance.id)).toEqual(['user-1', 'user-2', 'user-1', 'user-2']);
  });

  it('fails over to the next instance when the request was never delivered', async () => {
    const { handle, calls, logs } = setup(
      (_pattern, _payload, inst) => {
        if (inst.id === 'user-1') throw refused(inst);
        return { servedBy: inst.id };
      },
      { instances: [i1, i2] },
    );

    const res = await handle({ method: 'POST', url: '/users', body: { name: 'Nam' } });

    expect(res.status).toBe(201); // POST vẫn failover được: service chưa hề nhận request
    expect(res.body).toEqual({ servedBy: 'user-2' });
    expect(calls.map((c) => c.instance.id)).toEqual(['user-1', 'user-2']);
    expect(calls[1].payload).toBe(calls[0].payload); // cùng một payload, cùng requestId
    expect(logs.join()).toContain('failing over to the next instance');
  });

  it('does NOT fail over when the connection broke after sending (may have been processed)', async () => {
    const { handle, calls } = setup(
      (_pattern, _payload, inst) => {
        throw reset(inst);
      },
      { instances: [i1, i2] },
    );
    const res = await handle({ method: 'POST', url: '/users', body: {} });
    expect(res.status).toBe(502);
    expect(calls).toHaveLength(1);
  });

  it('does NOT fail over on timeout', async () => {
    const { handle, calls } = setup(
      (pattern, _payload, inst) => {
        throw new RpcTimeoutError(pattern, inst, 1234);
      },
      { instances: [i1, i2] },
    );
    expect((await handle({ url: '/users/1' })).status).toBe(504);
    expect(calls).toHaveLength(1);
  });

  it('does NOT fail over on a business error from the service', async () => {
    const { handle, calls } = setup(
      (pattern, _payload, inst) => {
        throw new RpcRemoteError(pattern, inst, { statusCode: 404, message: 'nope', code: 'USER_NOT_FOUND' });
      },
      { instances: [i1, i2] },
    );
    expect((await handle({ url: '/users/1' })).status).toBe(404);
    expect(calls).toHaveLength(1);
  });

  it('returns 502 and lists every instance tried when none is reachable', async () => {
    const { handle, calls, logs } = setup(
      (_pattern, _payload, inst) => {
        throw refused(inst);
      },
      { instances: [i1, i2] },
    );
    const res = await handle({ url: '/users/1' });
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
    expect(calls).toHaveLength(2);
    expect(logs.join()).toContain('all 2 instance(s) unreachable: user-1, user-2');
  });

  it('respects maxAttempts', async () => {
    const { handle, calls } = setup(
      (_pattern, _payload, inst) => {
        throw refused(inst);
      },
      { instances: [i1, i2, i3], maxAttempts: 2 },
    );
    expect((await handle({ url: '/users/1' })).status).toBe(502);
    expect(calls).toHaveLength(2);
  });

  it('maxAttempts = 1 disables failover', async () => {
    const { handle, calls } = setup(
      (_pattern, _payload, inst) => {
        if (inst.id === 'user-1') throw refused(inst);
        return { ok: true };
      },
      { instances: [i1, i2], maxAttempts: 1 },
    );
    expect((await handle({ url: '/users/1' })).status).toBe(502);
    expect(calls).toHaveLength(1);
  });
});


describe('GatewayHandler: permission check', () => {
  const protectedRoutes: RouteDefinition[] = [
    { method: 'get', path: '/users', operationId: 'users.list', successStatus: 200, requiresAuth: true, permissions: ['users:read'] },
    { method: 'post', path: '/users', operationId: 'users.create', successStatus: 201, requiresAuth: true, permissions: ['users:read', 'users:write'] },
    { method: 'get', path: '/me', operationId: 'me.get', successStatus: 200, requiresAuth: true, permissions: [] },
    { method: 'get', path: '/open', operationId: 'open.get', successStatus: 200, requiresAuth: false },
  ];

  function build(permissionsOf?: (id: string) => Promise<ReadonlySet<string>>) {
    const { transport, calls } = fakeTransport(() => ({ ok: true }));
    const lookups: string[] = [];
    const logs: string[] = [];
    const handler = new GatewayHandler({
      project: 'identity',
      authenticator: { authenticate: async () => ({ sub: 'alice', iss: 'issuer' }) },
      ...(permissionsOf && {
        permissionResolver: {
          permissionsOf: async (id) => {
            lookups.push(id);
            return permissionsOf(id);
          },
        },
      }),
      routeTable: RouteTable.from(protectedRoutes),
      discovery: fakeDiscovery([instance]),
      transport,
      balancer: new RoundRobinBalancer(),
      rpcTimeoutMs: 1000,
      maxAttempts: 1,
      logger: { warn: (m) => logs.push(m), error: (m) => logs.push(m) },
    });
    const handle = (method: string, url: string, body?: unknown) =>
      handler.handle({ method, url, headers: { authorization: 'Bearer t' }, body });
    return { handle, calls, lookups, logs };
  }

  it('forwards the request when every required permission is granted', async () => {
    const { handle, calls, lookups } = build(async () => new Set(['users:read', 'users:write']));
    expect((await handle('POST', '/users', {})).status).toBe(201);
    expect(calls).toHaveLength(1);
    expect(lookups).toEqual(['alice']);
  });

  it('returns 403 and never dispatches when a permission is missing (AND semantics)', async () => {
    const { handle, calls } = build(async () => new Set(['users:read']));
    const res = await handle('POST', '/users', {});
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'FORBIDDEN' });
    expect(JSON.stringify(res.body)).not.toContain('users:write');
    expect(calls).toHaveLength(0);
  });

  it('skips the lookup when the route only needs authentication', async () => {
    const { handle, lookups } = build(async () => new Set());
    expect((await handle('GET', '/me')).status).toBe(200);
    expect(lookups).toEqual([]);
  });

  it('fails closed with 503 when the lookup fails, without leaking the cause', async () => {
    const { handle, calls, logs } = build(async () => {
      throw new Error('mongodb://secret@host');
    });
    const res = await handle('GET', '/users');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'AUTHZ_UNAVAILABLE' });
    expect(JSON.stringify(res.body)).not.toContain('secret');
    expect(logs.join(' ')).toContain('permission lookup failed');
    expect(calls).toHaveLength(0);
  });

  it('fails closed with 503 when a route needs permissions but no resolver exists', async () => {
    const { handle, calls } = build();
    expect((await handle('GET', '/users')).status).toBe(503);
    expect(calls).toHaveLength(0);
  });

  it('does not consult the resolver for public routes', async () => {
    const { handle, lookups } = build(async () => new Set());
    expect((await handle('GET', '/open')).status).toBe(200);
    expect(lookups).toEqual([]);
  });
});


describe('GatewayHandler: CORS', () => {
  const ORIGIN = 'http://localhost:3001';
  function build(corsOrigins?: string[]) {
    const { transport, calls } = fakeTransport(() => ({ ok: true }));
    const authenticate = jest.fn(async () => ({ sub: 'alice', iss: 'issuer' }));
    const handler = new GatewayHandler({
      project: 'identity',
      authenticator: { authenticate },
      ...(corsOrigins && { corsOrigins }),
      routeTable: RouteTable.from([
        { method: 'get', path: '/me', operationId: 'me.get', successStatus: 200, requiresAuth: true, permissions: [] },
      ]),
      discovery: fakeDiscovery([instance]),
      transport,
      balancer: new RoundRobinBalancer(),
      rpcTimeoutMs: 1000,
      maxAttempts: 1,
    });
    return { handler, calls, authenticate };
  }
  const preflight = (origin?: string) => ({
    method: 'OPTIONS',
    url: '/me',
    headers: {
      ...(origin && { origin }),
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'authorization',
    },
  });

  it('answers an allowed preflight with 204 before authentication, without dispatching', async () => {
    const { handler, calls, authenticate } = build([ORIGIN]);
    const res = await handler.handle(preflight(ORIGIN));
    expect(res.status).toBe(204);
    expect(res.headers).toMatchObject({
      'access-control-allow-origin': ORIGIN,
      'access-control-allow-headers': expect.stringContaining('authorization'),
      vary: 'Origin',
    });
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
    expect(authenticate).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('rejects a preflight from an unknown origin with 403 and no CORS headers', async () => {
    const { handler } = build([ORIGIN]);
    const res = await handler.handle(preflight('http://evil.example'));
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'CORS_ORIGIN_NOT_ALLOWED' });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('adds CORS headers to a real response only for an allowed origin', async () => {
    const { handler } = build([ORIGIN]);
    const ok = await handler.handle({ method: 'GET', url: '/me', headers: { origin: ORIGIN, authorization: 'Bearer t' } });
    expect(ok.status).toBe(200);
    expect(ok.headers).toMatchObject({
      'access-control-allow-origin': ORIGIN,
      'access-control-expose-headers': 'x-request-id',
      vary: 'Origin',
    });
    const other = await handler.handle({ method: 'GET', url: '/me', headers: { origin: 'http://evil.example', authorization: 'Bearer t' } });
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
    expect(other.headers.vary).toBe('Origin');
  });

  it('keeps CORS headers on error responses so the browser can read the problem', async () => {
    const { handler } = build([ORIGIN]);
    const res = await handler.handle({ method: 'GET', url: '/missing', headers: { origin: ORIGIN } });
    expect(res.status).toBe(404);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
  });

  it('is disabled when no origin is configured', async () => {
    const { handler } = build();
    const res = await handler.handle({ method: 'GET', url: '/me', headers: { origin: ORIGIN, authorization: 'Bearer t' } });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers.vary).toBeUndefined();
    expect((await handler.handle(preflight(ORIGIN))).status).toBe(405);
  });
});
