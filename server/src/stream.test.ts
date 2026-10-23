import { describe, expect, it } from 'vitest';
import { Ring, frame } from './stream.js';

describe('Ring', () => {
  it('replays what one chat missed and nothing from other chats', () => {
    const ring = new Ring(10);
    const a = {};
    const b = {};
    const first = ring.push('a1', a);
    ring.push('b1', b);
    ring.push('all', null);
    ring.push('a2', a);
    expect(ring.since(first, a)?.map((e) => e.data)).toEqual(['all', 'a2']);
    expect(ring.since(ring.seq, a)).toEqual([]);
  });

  it('refuses ids that fell out of the buffer or come from another server', () => {
    const ring = new Ring(3);
    const first = ring.push('1', null);
    expect(ring.since(first - 1, null)?.map((e) => e.data)).toEqual(['1']);
    ring.push('2', null);
    ring.push('3', null);
    ring.push('4', null);
    expect(ring.since(first - 1, null)).toBeNull();
    expect(ring.since(first, null)?.map((e) => e.data)).toEqual(['2', '3', '4']);
    expect(ring.since(ring.seq + 10, null)).toBeNull();
    expect(ring.since(NaN, null)).toBeNull();
  });

  it('frames an event with and without an id', () => {
    expect(frame('{"a":1}', 7)).toBe('id: 7\ndata: {"a":1}\n\n');
    expect(frame('x')).toBe('data: x\n\n');
  });
});
