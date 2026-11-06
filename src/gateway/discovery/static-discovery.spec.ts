import path from 'node:path';
import { ConfigError } from '../errors';
import { StaticDiscovery } from './static-discovery';

const FIXTURE = path.resolve(__dirname, '../../../test/fixtures/discovery.json');

const entry = (overrides: Record<string, unknown> = {}) => ({
  project: 'shop',
  service: 'user',
  id: 'user-1',
  host: '127.0.0.1',
  port: 4001,
  patterns: ['user.getById'],
  ...overrides,
});

describe('StaticDiscovery', () => {
  it('resolves instances by project and pattern', async () => {
    const discovery = StaticDiscovery.fromFile(FIXTURE);

    expect((await discovery.resolve('demo', 'user.getById')).map((i) => i.id)).toEqual(['user-1', 'user-2']);
    expect((await discovery.resolve('demo', 'user.list')).map((i) => i.id)).toEqual(['user-1']);
    expect(discovery.patterns('demo')).toEqual(['user.getById', 'user.list']);
  });

  it('returns an empty list for unknown patterns or projects', async () => {
    const discovery = StaticDiscovery.fromFile(FIXTURE);
    expect(await discovery.resolve('demo', 'order.list')).toEqual([]);
    expect(await discovery.resolve('other', 'user.getById')).toEqual([]);
  });

  it('scopes patterns by project', async () => {
    const discovery = StaticDiscovery.fromEntries({
      instances: [entry(), entry({ project: 'blog', service: 'author', id: 'author-1', port: 5001 })],
    });
    expect((await discovery.resolve('shop', 'user.getById'))[0].service).toBe('user');
    expect((await discovery.resolve('blog', 'user.getById'))[0].service).toBe('author');
  });

  it('returns a copy, so callers cannot mutate the table', async () => {
    const discovery = StaticDiscovery.fromEntries({ instances: [entry()] });
    (await discovery.resolve('shop', 'user.getById')).pop();
    expect(await discovery.resolve('shop', 'user.getById')).toHaveLength(1);
  });

  it('rejects two different services owning the same pattern in one project', () => {
    expect(() =>
      StaticDiscovery.fromEntries({
        instances: [entry(), entry({ service: 'legacy-user', id: 'legacy-1' })],
      }),
    ).toThrow(/pattern "user.getById" in project "shop" is already handled by service "user"/);
  });

  it('reports every invalid field at once', () => {
    try {
      StaticDiscovery.fromEntries({
        instances: [entry({ host: '', port: 0 }), entry({ id: 'user-1' }), entry({ patterns: [] , id: 'x' })],
      });
      throw new Error('expected ConfigError');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const message = (error as Error).message;
      expect(message).toContain('instances[0]: "host" must be a non-empty string.');
      expect(message).toContain('instances[0]: "port" must be an integer');
      expect(message).toContain('instances[2]: "patterns" must be a non-empty array');
    }
  });

  it('rejects duplicate instance ids', () => {
    expect(() => StaticDiscovery.fromEntries({ instances: [entry(), entry()] })).toThrow(
      /duplicate instance id "user-1"/,
    );
  });

  it('rejects files with the wrong shape or invalid JSON', () => {
    expect(() => StaticDiscovery.fromEntries([])).toThrow(/expected \{ "instances": \[\.\.\.\] \}/);
    expect(() => StaticDiscovery.fromFile('/nope.json')).toThrow(/Cannot read discovery file/);
  });
});
