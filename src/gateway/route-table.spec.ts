import { RouteTable, routeShape, splitPath } from './route-table';
import type { HttpMethod, RouteDefinition } from './types';

function route(method: HttpMethod, path: string, operationId: string): RouteDefinition {
  return { method, path, operationId, successStatus: 200 };
}

describe('RouteTable', () => {
  const table = RouteTable.from([
    route('get', '/', 'root.index'),
    route('get', '/users', 'user.list'),
    route('post', '/users', 'user.create'),
    route('get', '/users/me', 'user.getMe'),
    route('get', '/users/{id}', 'user.getById'),
    route('delete', '/users/{id}', 'user.remove'),
    route('get', '/users/{userId}/orders', 'order.listByUser'),
    route('get', '/users/{userId}/orders/{orderId}', 'order.getOne'),
    route('post', '/files/upload', 'file.upload'),
    route('get', '/files/{name}', 'file.get'),
  ]);

  function found(method: string, path: string) {
    const result = table.match(method, path);
    if (result.kind !== 'found') throw new Error(`expected found, got ${result.kind}`);
    return result;
  }

  it('counts inserted routes', () => {
    expect(table.size).toBe(10);
  });

  it('matches the root path', () => {
    expect(found('GET', '/').route.operationId).toBe('root.index');
  });

  it('matches static routes, case-insensitive on method', () => {
    expect(found('get', '/users').route.operationId).toBe('user.list');
    expect(found('POST', '/users').route.operationId).toBe('user.create');
  });

  it('extracts path params', () => {
    const result = found('GET', '/users/42');
    expect(result.route.operationId).toBe('user.getById');
    expect(result.params).toEqual({ id: '42' });
  });

  it('prefers a static segment over a param segment', () => {
    expect(found('GET', '/users/me').route.operationId).toBe('user.getMe');
  });

  it('backtracks to the param branch when the static branch has no such method', () => {
    // /users/me chỉ có GET. DELETE /users/me phải rơi xuống DELETE /users/{id} với id = "me".
    const result = found('DELETE', '/users/me');
    expect(result.route.operationId).toBe('user.remove');
    expect(result.params).toEqual({ id: 'me' });
  });

  it('backtracks when the static branch is a dead end deeper in the tree', () => {
    // "upload" là nhánh tĩnh nhưng chỉ có POST; GET phải rơi xuống /files/{name}.
    const result = found('GET', '/files/upload');
    expect(result.route.operationId).toBe('file.get');
    expect(result.params).toEqual({ name: 'upload' });
  });

  it('supports different param names at the same position', () => {
    const result = found('GET', '/users/7/orders/99');
    expect(result.route.operationId).toBe('order.getOne');
    expect(result.params).toEqual({ userId: '7', orderId: '99' });
  });

  it('ignores the query string, fragment and trailing slash', () => {
    expect(found('GET', '/users/42/?active=true#top').params).toEqual({ id: '42' });
    expect(found('GET', '/users?page=2').route.operationId).toBe('user.list');
  });

  it('decodes params after matching, so %2F stays inside one param', () => {
    expect(found('GET', '/files/a%2Fb.txt').params).toEqual({ name: 'a/b.txt' });
    expect(found('GET', '/users/Nguy%E1%BB%85n').params).toEqual({ id: 'Nguyễn' });
  });

  it('returns invalid_path for malformed percent-encoding', () => {
    expect(table.match('GET', '/users/%E0%A4%A')).toEqual({ kind: 'invalid_path' });
  });

  it('returns not_found for unknown paths', () => {
    expect(table.match('GET', '/products')).toEqual({ kind: 'not_found' });
    expect(table.match('GET', '/users/1/orders/2/extra')).toEqual({ kind: 'not_found' });
  });

  it('does not match an empty param segment', () => {
    expect(table.match('GET', '/users//orders')).toEqual({ kind: 'not_found' });
  });

  it('returns method_not_allowed with every allowed method across candidates', () => {
    // /users/me: GET (nhánh tĩnh) + GET, DELETE (nhánh /users/{id}).
    expect(table.match('PUT', '/users/me')).toEqual({
      kind: 'method_not_allowed',
      allowed: ['delete', 'get'],
    });
  });

  it('rejects two routes with the same method and shape', () => {
    const t = new RouteTable();
    t.insert(route('get', '/items/{id}', 'item.get'));
    expect(() => t.insert(route('get', '/items/{itemId}', 'item.other'))).toThrow(/Route conflict/);
  });
});

describe('splitPath / routeShape', () => {
  it('normalises leading and trailing slashes', () => {
    expect(splitPath('/')).toEqual([]);
    expect(splitPath('/users/')).toEqual(['users']);
    expect(splitPath('users/42')).toEqual(['users', '42']);
  });

  it('ignores param names in the shape', () => {
    expect(routeShape('/users/{id}')).toBe(routeShape('/users/{userId}/'));
    expect(routeShape('/users/{id}')).toBe('/users/{}');
  });
});
