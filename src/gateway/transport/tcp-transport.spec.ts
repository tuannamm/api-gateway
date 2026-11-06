import type { INestMicroservice } from '@nestjs/common';
import { getFreePort, startEchoFixture } from '../../../test/support/echo-fixture';
import type { Instance } from '../discovery/types';
import { TcpTransport } from './tcp-transport';
import {
  RpcConnectionError,
  RpcPatternNotHandledError,
  RpcRemoteError,
  RpcTimeoutError,
} from './types';

/**
 * Integration test với microservice TCP thật (cùng process).
 * Yêu cầu Node ≥ 24.9 (NestJS 12 là ESM-only).
 */
describe('TcpTransport', () => {
  let echo: INestMicroservice;
  let instance: Instance;
  let transport: TcpTransport;

  const payload = (id: string) => ({ params: { id }, query: {}, meta: { requestId: 'r', operationId: 'user.getById', project: 'p' } });

  beforeAll(async () => {
    const port = await getFreePort();
    echo = await startEchoFixture(port);
    instance = { id: 'echo-1', service: 'echo', host: '127.0.0.1', port };
  });

  beforeEach(() => {
    transport = new TcpTransport();
  });

  afterEach(async () => {
    await transport.close();
  });

  afterAll(async () => {
    await echo.close();
  });

  it('sends a message and returns the response', async () => {
    const result = await transport.send(instance, 'user.getById', payload('42'), 1_000);
    expect(result).toMatchObject({ echo: { params: { id: '42' } } });
  });

  it('reuses one connection per host:port', async () => {
    await transport.send(instance, 'user.getById', payload('1'), 1_000);
    await transport.send(instance, 'user.getById', payload('2'), 1_000);
    expect(transport.poolSize).toBe(1);
  });

  it('resolves undefined when the handler returns nothing', async () => {
    await expect(transport.send(instance, 'user.remove', payload('1'), 1_000)).resolves.toBeUndefined();
  });

  it('wraps a service RpcException as RpcRemoteError with the original payload', async () => {
    const error = await transport.send(instance, 'user.getById', payload('missing'), 1_000).catch((e) => e);
    expect(error).toBeInstanceOf(RpcRemoteError);
    expect((error as RpcRemoteError).payload).toMatchObject({ statusCode: 404, code: 'USER_NOT_FOUND' });
  });

  it('detects a pattern the service does not handle', async () => {
    await expect(transport.send(instance, 'user.getMe', payload('1'), 1_000)).rejects.toBeInstanceOf(
      RpcPatternNotHandledError,
    );
  });

  it('times out', async () => {
    await expect(transport.send(instance, 'user.getById', payload('slow'), 100)).rejects.toBeInstanceOf(
      RpcTimeoutError,
    );
  });

  it('reports an unreachable instance as NOT delivered and evicts it from the pool', async () => {
    const dead: Instance = { ...instance, id: 'dead', port: await getFreePort() };
    const error = await transport.send(dead, 'user.getById', payload('1'), 1_000).catch((e) => e);
    expect(error).toBeInstanceOf(RpcConnectionError);
    // ECONNREFUSED: chưa mở được kết nối, request chắc chắn chưa tới service → được phép failover.
    expect((error as RpcConnectionError).delivered).toBe(false);
    expect(transport.poolSize).toBe(0);
  });
});
