import { GatewayError, toProblem } from './problem';

describe('toProblem', () => {
  it('builds an RFC 9457 body with the standard title for the status', () => {
    const problem = toProblem(new GatewayError(404, 'ROUTE_NOT_FOUND', 'No route'), 'req-1', '/nope');

    expect(problem).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'No route',
      instance: '/nope',
      code: 'ROUTE_NOT_FOUND',
      requestId: 'req-1',
    });
  });

  it('includes details only when present', () => {
    const problem = toProblem(new GatewayError(422, 'INVALID', 'Bad', {}, { field: 'email' }), 'r', '/x');
    expect(problem.details).toEqual({ field: 'email' });
    expect(problem.title).toBe('Unprocessable Entity');
  });
});
