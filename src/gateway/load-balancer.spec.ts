import type { Instance } from './discovery/types';
import { RoundRobinBalancer } from './load-balancer';

const inst = (id: string): Instance => ({ id, service: 'user', host: '127.0.0.1', port: 4000 });
const ids = (list: Instance[]) => list.map((i) => i.id);

describe('RoundRobinBalancer', () => {
  const a = inst('a');
  const b = inst('b');
  const c = inst('c');

  it('rotates the primary instance and keeps the rest as failover order', () => {
    const lb = new RoundRobinBalancer();
    expect(ids(lb.order('p', [a, b, c]))).toEqual(['a', 'b', 'c']);
    expect(ids(lb.order('p', [a, b, c]))).toEqual(['b', 'c', 'a']);
    expect(ids(lb.order('p', [a, b, c]))).toEqual(['c', 'a', 'b']);
    expect(ids(lb.order('p', [a, b, c]))).toEqual(['a', 'b', 'c']);
  });

  it('spreads requests evenly', () => {
    const lb = new RoundRobinBalancer();
    const hits: Record<string, number> = {};
    for (let i = 0; i < 300; i++) {
      const primary = lb.order('p', [a, b, c])[0].id;
      hits[primary] = (hits[primary] ?? 0) + 1;
    }
    expect(hits).toEqual({ a: 100, b: 100, c: 100 });
  });

  it('keeps an independent counter per key', () => {
    const lb = new RoundRobinBalancer();
    // Xen kẽ hai pattern: mỗi pattern vẫn phải luân phiên a, b (bộ đếm chung sẽ cho mỗi pattern luôn một instance).
    const first: string[] = [];
    const second: string[] = [];
    for (let i = 0; i < 4; i++) {
      first.push(lb.order('shop|user.getById', [a, b])[0].id);
      second.push(lb.order('shop|user.list', [a, b])[0].id);
    }
    expect(first).toEqual(['a', 'b', 'a', 'b']);
    expect(second).toEqual(['a', 'b', 'a', 'b']);
  });

  it('is stable when discovery returns instances in a different order', () => {
    const lb = new RoundRobinBalancer();
    expect(ids(lb.order('p', [c, a, b]))).toEqual(['a', 'b', 'c']);
    expect(ids(lb.order('p', [b, c, a]))).toEqual(['b', 'c', 'a']);
  });

  it('handles one or zero instances', () => {
    const lb = new RoundRobinBalancer();
    expect(ids(lb.order('p', [a]))).toEqual(['a']);
    expect(ids(lb.order('p', [a]))).toEqual(['a']);
    expect(lb.order('p', [])).toEqual([]);
  });

  it('does not mutate the input list', () => {
    const lb = new RoundRobinBalancer();
    const input = [c, b, a];
    lb.order('p', input);
    expect(ids(input)).toEqual(['c', 'b', 'a']);
  });
});
