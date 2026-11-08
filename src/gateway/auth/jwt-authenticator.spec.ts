import { createServer, type Server } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { JwtAuthenticator } from './jwt-authenticator';
import { GatewayHandler } from '../gateway-handler';
import { RouteTable } from '../route-table';
import { RoundRobinBalancer } from '../load-balancer';
import { extractRoutes } from '../spec-loader';
import type { OpenAPI } from 'openapi-types';

describe('Keycloak JWT verification', () => {
  let server: Server, issuer: string, auth: JwtAuthenticator;
  let key: Awaited<ReturnType<typeof generateKeyPair>>;
  let jwks: object[];
  beforeAll(async () => {
    key = await generateKeyPair('RS256');
    jwks = [{ ...await exportJWK(key.publicKey), kid: 'one', alg: 'RS256' }];
    server = createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: jwks })); });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    issuer = `http://127.0.0.1:${(server.address() as { port: number }).port}/realms/test`;
    auth = new JwtAuthenticator(issuer, 'w-identity');
  });
  afterAll(async () => { await new Promise<void>(r => server.close(() => r())); });
  const token = (overrides: Record<string, unknown> = {}, kid = 'one') => new SignJWT({ typ: 'Bearer', realm_access: { roles: ['admin'] }, ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid }).setIssuer(issuer).setSubject('alice').setAudience('w-identity').setIssuedAt().setExpirationTime('5m');
  it('accepts verified claims only', async () => {
    expect(await auth.authenticate(`Bearer ${await token().sign(key.privateKey)}`)).toEqual({ sub: 'alice', iss: issuer, roles: ['admin'] });
  });
  it('rejects missing, expired, wrong audience, issuer, signature and token type', async () => {
    await expect(auth.authenticate(undefined)).rejects.toMatchObject({ status: 401 });
    for (const jwt of [token().setExpirationTime(0), token().setAudience('other'), token().setIssuer('https://other'), token({ typ: 'ID' })]) {
      await expect(auth.authenticate(`Bearer ${await jwt.sign(key.privateKey)}`)).rejects.toMatchObject({ status: 401 });
    }
    const other = await generateKeyPair('RS256');
    await expect(auth.authenticate(`Bearer ${await token().sign(other.privateKey)}`)).rejects.toMatchObject({ status: 401 });
  });
  it('refreshes JWKS when key rotates', async () => {
    const rotated = await generateKeyPair('RS256');
    jwks.push({ ...await exportJWK(rotated.publicKey), kid: 'two', alg: 'RS256' });
    await new Promise(r => setTimeout(r, 1100));
    const jwt = await token({}, 'two').sign(rotated.privateKey);
    expect(await auth.authenticate(`Bearer ${jwt}`)).toMatchObject({ sub: 'alice' });
  });
  it('protects default routes and never dispatches unverified requests', async () => {
    const send = jest.fn(async (..._args: any[]) => ({ ok: true }));
    const handler = new GatewayHandler({ project: 'identity', authenticator: auth,
      routeTable: RouteTable.from([{ method: 'get', path: '/me', operationId: 'identity.me.get', successStatus: 200 }]),
      discovery: { resolve: async () => [{ id: 'one', service: 'identity', host: 'localhost', port: 1 }] },
      transport: { send, close: async () => undefined }, balancer: new RoundRobinBalancer(), maxAttempts: 1, rpcTimeoutMs: 1000 });
    expect((await handler.handle({ method: 'GET', url: '/me', headers: {}, body: { user: { sub: 'admin' } } })).status).toBe(401);
    expect(send).not.toHaveBeenCalled();
    await handler.handle({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${await token().sign(key.privateKey)}` } });
    expect(send.mock.calls[0][2].user).toMatchObject({ sub: 'alice' });
  });
});

describe('OpenAPI security', () => {
  const doc = (security?: unknown) => ({ openapi: '3.0.3', info: { title: 'test', version: '1' }, paths: { '/me': { get: { operationId: 'me', responses: { '200': { description: 'ok' } }, ...(security !== undefined ? { security } : {}) } } } }) as OpenAPI.Document;
  it('defaults to protected and allows explicit public routes', () => {
    expect(extractRoutes(doc())[0].requiresAuth).toBe(true);
    expect(extractRoutes(doc([]))[0].requiresAuth).toBe(false);
  });
  it('rejects unknown or anonymous alternative schemes', () => {
    expect(() => extractRoutes(doc([{ basic: [] }]))).toThrow();
    expect(() => extractRoutes(doc([{}]))).toThrow();
  });
});
