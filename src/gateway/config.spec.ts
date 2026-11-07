import path from 'node:path';
import { loadConfig, listProjects } from './config';
import { ConfigError } from './errors';

const APP_ROOT = path.resolve(__dirname, '../..');
const FIXTURES = path.join(APP_ROOT, 'test/fixtures/specs');
const REGISTRY_URL = 'http://localhost:8500';

/** env tối thiểu trỏ vào thư mục fixture. */
function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { GATEWAY_SPECS_DIR: FIXTURES, GATEWAY_REGISTRY_URL: REGISTRY_URL, ...overrides };
}

describe('loadConfig', () => {
  it('resolves the spec path of the selected project', () => {
    const config = loadConfig(env({ GATEWAY_PROJECT: 'demo' }));

    expect(config.project).toBe('demo');
    expect(config.specsDir).toBe(FIXTURES);
    expect(config.specPath).toBe(path.join(FIXTURES, 'demo', 'openapi.yml'));
  });

  it('defaults GATEWAY_SPECS_DIR to ./specs and resolves files relative to cwd', () => {
    const config = loadConfig(
      { GATEWAY_PROJECT: 'example', GATEWAY_REGISTRY_URL: REGISTRY_URL },
      APP_ROOT,
    );
    expect(config.specPath).toBe(path.join(APP_ROOT, 'specs', 'example', 'openapi.yml'));
  });

  it('applies defaults for timeout, body limit and port', () => {
    expect(loadConfig(env({ GATEWAY_PROJECT: 'demo' }))).toMatchObject({
      rpcTimeoutMs: 10_000,
      bodyLimit: 1024 * 1024,
      failoverMaxAttempts: 3,
      port: 3000,
    });
  });

  it('reads GATEWAY_FAILOVER_MAX_ATTEMPTS (1 disables failover, max 10)', () => {
    expect(loadConfig(env({ GATEWAY_PROJECT: 'demo', GATEWAY_FAILOVER_MAX_ATTEMPTS: '1' })).failoverMaxAttempts).toBe(1);
    expect(() => loadConfig(env({ GATEWAY_PROJECT: 'demo', GATEWAY_FAILOVER_MAX_ATTEMPTS: '0' }))).toThrow(
      /GATEWAY_FAILOVER_MAX_ATTEMPTS must be an integer between 1 and 10/,
    );
    expect(() => loadConfig(env({ GATEWAY_PROJECT: 'demo', GATEWAY_FAILOVER_MAX_ATTEMPTS: '11' }))).toThrow(
      /GATEWAY_FAILOVER_MAX_ATTEMPTS/,
    );
  });

  it('reads numeric settings from env', () => {
    const config = loadConfig(
      env({ GATEWAY_PROJECT: 'demo', GATEWAY_RPC_TIMEOUT_MS: '2500', GATEWAY_BODY_LIMIT: '2048', PORT: '8080' }),
    );
    expect(config).toMatchObject({ rpcTimeoutMs: 2500, bodyLimit: 2048, port: 8080 });
  });

  it.each([
    ['GATEWAY_RPC_TIMEOUT_MS', 'abc'],
    ['GATEWAY_RPC_TIMEOUT_MS', '0'],
    ['GATEWAY_BODY_LIMIT', '-1'],
    ['GATEWAY_BODY_LIMIT', '1.5'],
    ['PORT', '70000'],
  ])('rejects invalid %s=%p', (name, value) => {
    expect(() => loadConfig(env({ GATEWAY_PROJECT: 'demo', [name]: value }))).toThrow(
      new RegExp(`${name} must be an integer`),
    );
  });

  describe('registry', () => {
    it('requires GATEWAY_REGISTRY_URL', () => {
      expect(() => loadConfig(env({ GATEWAY_PROJECT: 'demo', GATEWAY_REGISTRY_URL: undefined }))).toThrow(
        /GATEWAY_REGISTRY_URL is required/,
      );
      expect(() => loadConfig(env({ GATEWAY_PROJECT: 'demo', GATEWAY_REGISTRY_URL: '  ' }))).toThrow(
        /GATEWAY_REGISTRY_URL is required/,
      );
    });

    it('strips the trailing slash and defaults the poll interval to 3s', () => {
      const config = loadConfig(env({ GATEWAY_PROJECT: 'demo', GATEWAY_REGISTRY_URL: 'http://localhost:8500/' }));
      expect(config.discovery).toEqual({ url: 'http://localhost:8500', pollIntervalMs: 3_000 });
    });

    it('reads GATEWAY_REGISTRY_POLL_MS (max 60s)', () => {
      const base = { GATEWAY_PROJECT: 'demo', GATEWAY_REGISTRY_URL: 'http://registry:8500' };
      expect(loadConfig(env({ ...base, GATEWAY_REGISTRY_POLL_MS: '1000' })).discovery).toMatchObject({
        pollIntervalMs: 1_000,
      });
      expect(() => loadConfig(env({ ...base, GATEWAY_REGISTRY_POLL_MS: '60001' }))).toThrow(
        /GATEWAY_REGISTRY_POLL_MS must be an integer/,
      );
    });

    it.each([
      ['not a url', /not a valid URL/],
      ['ftp://registry:8500', /must use http or https/],
      ['http://registry:8500?x=1', /must not contain a query/],
    ])('rejects GATEWAY_REGISTRY_URL=%p', (url, message) => {
      expect(() => loadConfig(env({ GATEWAY_PROJECT: 'demo', GATEWAY_REGISTRY_URL: url }))).toThrow(message);
    });
  });

  it('requires GATEWAY_PROJECT and lists the available projects', () => {
    expect(() => loadConfig(env({}))).toThrow(ConfigError);
    expect(() => loadConfig(env({ GATEWAY_PROJECT: '  ' }))).toThrow(
      /GATEWAY_PROJECT is required.*Available projects.*broken, demo, not-openapi/,
    );
  });

  it('fails for an unknown project and lists the available ones', () => {
    expect(() => loadConfig(env({ GATEWAY_PROJECT: 'shop' }))).toThrow(
      /Spec file not found for project "shop".*Available projects.*demo/,
    );
  });

  it.each(['../demo', '../../etc', 'demo/../demo', 'Demo', 'a.b', '/etc'])(
    'blocks invalid / traversal project name %p',
    (project) => {
      expect(() => loadConfig(env({ GATEWAY_PROJECT: project }))).toThrow(/is invalid/);
    },
  );

  it.each(['../broken/openapi.yml', 'sub/openapi.yml', '..'])(
    'blocks a GATEWAY_SPEC_FILE that is a path: %p',
    (specFile) => {
      expect(() =>
        loadConfig(env({ GATEWAY_PROJECT: 'demo', GATEWAY_SPEC_FILE: specFile })),
      ).toThrow(/must be a plain file name/);
    },
  );

  it('reports when the specs directory does not exist', () => {
    expect(() =>
      loadConfig({ GATEWAY_PROJECT: 'demo', GATEWAY_SPECS_DIR: '/nope/specs' }),
    ).toThrow(/No projects found in \/nope\/specs/);
  });
});

describe('listProjects', () => {
  it('lists project directories, sorted', () => {
    expect(listProjects(FIXTURES)).toEqual(['broken', 'demo', 'not-openapi']);
  });

  it('returns an empty list for a missing directory', () => {
    expect(listProjects('/nope')).toEqual([]);
  });
});
