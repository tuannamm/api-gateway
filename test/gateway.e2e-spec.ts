import type { INestMicroservice } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import path from 'node:path';
import { createGatewayApp } from '../src/create-app';
import {
  GatewayHandler,
  loadSpec,
  RoundRobinBalancer,
  RouteTable,
  StaticDiscovery,
  TcpTransport,
  type Gateway,
} from '../src/gateway';
import { getFreePort, startEchoFixture } from './support/echo-fixture';

/**
 * E2E: HTTP thật (Fastify inject) → gateway → TCP thật → microservice fixture.
 * Yêu cầu Node ≥ 24.9 (NestJS 12 là ESM-only, Jest chỉ load được trên Node ≥ 24.9).
 */
describe('Gateway (e2e)', () => {
  let echo: INestMicroservice;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const echoPort = await getFreePort();
    const deadPort = await getFreePort(); // không có ai nghe ở cổng này
    echo = await startEchoFixture(echoPort);

    const spec = await loadSpec(path.join(__dirname, 'fixtures/specs/demo/openapi.yml'));
    const discovery = StaticDiscovery.fromEntries({
      instances: [
        {
          project: 'demo', service: 'echo', id: 'echo-1', host: '127.0.0.1', port: echoPort,
          patterns: ['user.getById', 'user.create', 'user.remove', 'user.list', 'user.getMe'],
        },
        {
          // Instance đã chết của cùng service: round-robin sẽ chọn nó mỗi lượt thứ hai, failover phải cứu.
          project: 'demo', service: 'echo', id: 'echo-2-dead', host: '127.0.0.1', port: deadPort,
          patterns: ['user.getById', 'user.create', 'user.remove', 'user.list', 'user.getMe'],
        },
        {
          project: 'demo', service: 'order', id: 'order-1', host: '127.0.0.1', port: deadPort,
          patterns: ['listOrdersOfUser'],
        },
        // "auth.login" cố ý không ai đăng ký → 503
      ],
    });
    const transport = new TcpTransport();
    const config = {
      project: 'demo', specsDir: '', specPath: '', discoveryFile: '',
      rpcTimeoutMs: 300, bodyLimit: 1024, failoverMaxAttempts: 3, port: 0,
    };
    const gateway: Gateway = {
      config,
      spec,
      transport,
      unservedPatterns: [],
      handler: new GatewayHandler({
        project: 'demo',
        routeTable: RouteTable.from(spec.routes),
        discovery,
        transport,
        balancer: new RoundRobinBalancer(),
        rpcTimeoutMs: config.rpcTimeoutMs,
        maxAttempts: config.failoverMaxAttempts,
      }),
    };

    app = await createGatewayApp(gateway);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    await echo?.close();
  });

  const inject = (opts: Parameters<NestFastifyApplication['inject']>[0]) => app.inject(opts);

  it('200: translates HTTP into a message and returns the service result', async () => {
    const res = await inject({ method: 'GET', url: '/users/42?tag=a&tag=b', headers: { 'x-evil': '1' } });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-request-id']).toEqual(expect.any(String));
    const { echo: received } = res.json();
    expect(received.params).toEqual({ id: '42' });
    expect(received.query).toEqual({ tag: ['a', 'b'] });
    expect(received.meta).toMatchObject({ operationId: 'user.getById', project: 'demo' });
    expect(received.meta.requestId).toBe(res.headers['x-request-id']);
    expect(JSON.stringify(received)).not.toContain('x-evil'); // header lạ không lọt xuống service
  });

  it('fails over from a dead instance: every request still succeeds', async () => {
    for (let n = 0; n < 4; n++) {
      const res = await inject({ method: 'GET', url: `/users/${n}` });
      expect(res.statusCode).toBe(200);
    }
  });

  it('keeps a valid x-request-id sent by the client', async () => {
    const res = await inject({ method: 'GET', url: '/users/1', headers: { 'x-request-id': 'trace-123' } });
    expect(res.headers['x-request-id']).toBe('trace-123');
  });

  it('201: success status comes from the spec', async () => {
    const res = await inject({ method: 'POST', url: '/users', payload: { name: 'Nam' } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ created: { name: 'Nam' } });
  });

  it('204: no body', async () => {
    const res = await inject({ method: 'DELETE', url: '/users/42' });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
  });

  it('404 from the service: business error mapped to problem+json', async () => {
    const res = await inject({ method: 'GET', url: '/users/missing' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({ status: 404, code: 'USER_NOT_FOUND', detail: 'User not found' });
  });

  it.each([
    ['GET', '/nope', 404, 'ROUTE_NOT_FOUND'],
    ['PUT', '/users/42', 405, 'METHOD_NOT_ALLOWED'],
    ['GET', '/users/%E0%A4%A', 400, 'INVALID_PATH'],
    ['POST', '/auth/login', 503, 'NO_INSTANCE'],
    ['GET', '/users/7/orders', 502, 'UPSTREAM_UNAVAILABLE'],
    ['GET', '/users/me', 502, 'PATTERN_NOT_HANDLED'],
    ['GET', '/users', 502, 'UPSTREAM_ERROR'],
    ['GET', '/users/slow', 504, 'UPSTREAM_TIMEOUT'],
  ])('%s %s → %i %s', async (method, url, status, code) => {
    const res = await inject({ method: method as 'GET', url });
    expect(res.statusCode).toBe(status);
    expect(res.json()).toMatchObject({ status, code, requestId: res.headers['x-request-id'] });
  });

  it('405 carries the Allow header', async () => {
    const res = await inject({ method: 'PUT', url: '/users/42' });
    expect(res.headers['allow']).toBe('DELETE, GET');
  });

  it('413 when the body exceeds the limit', async () => {
    const res = await inject({ method: 'POST', url: '/users', payload: { big: 'x'.repeat(2048) } });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it('415 for non-JSON bodies, 400 for broken JSON', async () => {
    const text = await inject({ method: 'POST', url: '/users', payload: 'hi', headers: { 'content-type': 'text/plain' } });
    expect(text.statusCode).toBe(415);
    expect(text.json()).toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE', requestId: text.headers['x-request-id'] });

    const broken = await inject({ method: 'POST', url: '/users', payload: '{"a":', headers: { 'content-type': 'application/json' } });
    expect(broken.statusCode).toBe(400);
    expect(broken.headers['content-type']).toContain('application/problem+json');
    expect(broken.json()).toMatchObject({ code: 'BAD_REQUEST' });
  });
});
