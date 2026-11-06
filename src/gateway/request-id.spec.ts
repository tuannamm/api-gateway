import { resolveRequestId } from './request-id';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('resolveRequestId', () => {
  it.each(['abc-123', 'trace.id_42', 'a'.repeat(128)])('keeps a valid client id %p', (id) => {
    expect(resolveRequestId(id)).toBe(id);
  });

  it('uses the first value when the header is repeated', () => {
    expect(resolveRequestId(['first', 'second'])).toBe('first');
  });

  it.each([undefined, '', 'a'.repeat(129), 'has space', 'line\nbreak', '<script>'])(
    'generates a new UUID for %p',
    (header) => {
      expect(resolveRequestId(header)).toMatch(UUID);
    },
  );

  it('generates a different id each time', () => {
    expect(resolveRequestId(undefined)).not.toBe(resolveRequestId(undefined));
  });
});
