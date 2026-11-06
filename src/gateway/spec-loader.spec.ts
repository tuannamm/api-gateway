import path from 'node:path';
import type { OpenAPI } from 'openapi-types';
import { SpecValidationError } from './errors';
import { extractRoutes, loadSpec, pickSuccessStatus } from './spec-loader';

const FIXTURES = path.resolve(__dirname, '../../test/fixtures/specs');
const fixture = (project: string) => path.join(FIXTURES, project, 'openapi.yml');

/** Chạy fn, bắt buộc nó ném SpecValidationError, trả về lỗi để kiểm tra chi tiết. */
async function expectSpecError(fn: () => unknown): Promise<SpecValidationError> {
  try {
    await fn();
  } catch (error) {
    expect(error).toBeInstanceOf(SpecValidationError);
    return error as SpecValidationError;
  }
  throw new Error('expected SpecValidationError to be thrown');
}

function doc(paths: Record<string, unknown>): OpenAPI.Document {
  return { openapi: '3.0.3', info: { title: 't', version: '1' }, paths } as OpenAPI.Document;
}

const ok = { responses: { '200': { description: 'OK' } } };

describe('loadSpec', () => {
  it('compiles a valid spec into routes', async () => {
    const spec = await loadSpec(fixture('demo'));

    expect(spec.title).toBe('Demo');
    expect(spec.routes).toHaveLength(7);
    expect(spec.routes).toContainEqual({
      method: 'get',
      path: '/users/{id}',
      operationId: 'user.getById',
      successStatus: 200,
    });
    expect(spec.routes).toContainEqual(
      expect.objectContaining({ path: '/users/{userId}/orders', operationId: 'listOrdersOfUser' }),
    );
  });

  it('takes the success status from the spec responses', async () => {
    const { routes } = await loadSpec(fixture('demo'));
    const status = (id: string) => routes.find((r) => r.operationId === id)?.successStatus;

    expect(status('user.create')).toBe(201); // khai báo '400' và '201' → lấy 201
    expect(status('user.remove')).toBe(204);
    expect(status('listOrdersOfUser')).toBe(200); // chỉ có 'default' → mặc định 200
  });

  it('reports ALL gateway rule violations at once', async () => {
    const error = await expectSpecError(() => loadSpec(fixture('broken')));

    expect(error.issues).toHaveLength(3);
    expect(error.issues[0]).toMatch(/GET \/a: missing operationId/);
    expect(error.issues[1]).toMatch(/GET \/b: operationId must not be empty/);
    expect(error.issues[2]).toMatch(/POST \/c: duplicate operationId "shared.op"/);
    expect(error.message).toContain('3 issue(s)');
  });

  it('rejects a document that is not valid OpenAPI', async () => {
    const error = await expectSpecError(() => loadSpec(fixture('not-openapi')));
    expect(error.issues).toHaveLength(1);
  });

  it('rejects a missing file', async () => {
    await expectSpecError(() => loadSpec(fixture('does-not-exist')));
  });
});

describe('extractRoutes', () => {
  it.each(['getInvoice', 'billing.getInvoice', 'GET_INVOICE', 'invoice:get', 'hoá-đơn'])(
    'accepts any non-empty operationId %p as-is',
    (operationId) => {
      const [r] = extractRoutes(doc({ '/x': { get: { operationId, ...ok } } }));
      expect(r.operationId).toBe(operationId);
    },
  );

  it.each(['', '   '])('rejects an empty operationId %p', async (operationId) => {
    const error = await expectSpecError(() =>
      extractRoutes(doc({ '/x': { get: { operationId, ...ok } } })),
    );
    expect(error.issues[0]).toMatch(/must not be empty/);
  });

  it.each([' getUser', 'getUser '])(
    'rejects leading/trailing whitespace in %p (would never match @MessagePattern)',
    async (operationId) => {
      const error = await expectSpecError(() =>
        extractRoutes(doc({ '/x': { get: { operationId, ...ok } } })),
      );
      expect(error.issues[0]).toMatch(/leading\/trailing whitespace/);
    },
  );

  it('rejects routes that only differ by param name', async () => {
    const error = await expectSpecError(() =>
      extractRoutes(
        doc({
          '/items/{id}': { get: { operationId: 'item.get', ...ok } },
          '/items/{itemId}': { get: { operationId: 'item.getAgain', ...ok } },
        }),
      ),
    );
    expect(error.issues[0]).toMatch(/ambiguous with GET \/items\/\{id\}/);
  });

  it('allows the same shape with different methods', () => {
    const routes = extractRoutes(
      doc({
        '/items/{id}': { get: { operationId: 'item.get', ...ok } },
        '/items/{itemId}': { delete: { operationId: 'item.remove', ...ok } },
      }),
    );
    expect(routes).toHaveLength(2);
  });

  it('rejects Swagger 2.0 documents', async () => {
    const error = await expectSpecError(() =>
      extractRoutes({ swagger: '2.0', info: { title: 't', version: '1' }, paths: {} } as OpenAPI.Document),
    );
    expect(error.issues[0]).toMatch(/Only OpenAPI 3.x/);
  });
});

describe('pickSuccessStatus', () => {
  it.each([
    [{ '200': {}, '201': {} }, 200],
    [{ '404': {}, '202': {} }, 202],
    [{ '2XX': {} }, 200],
    [{ default: {} }, 200],
    [undefined, 200],
  ])('%j → %i', (responses, expected) => {
    expect(pickSuccessStatus(responses as never)).toBe(expected);
  });
});
