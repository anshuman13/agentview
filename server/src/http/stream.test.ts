import { describe, expect, it } from 'bun:test';
import { Ring, frame } from './stream.js';
import { GRACE_MS, RingGate } from './ringGate.js';

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

  it('keeps no init bodies and asks for a fresh init when one went by', () => {
    const ring = new Ring(10);
    const a = {};
    const b = {};
    const first = ring.push('a1', a);
    const init = ring.push(null, a);
    const other = ring.push(null, b);
    ring.push('a2', a);
    expect(ring.since(first, a)).toBeNull();
    expect(ring.since(init, a)?.map((e) => e.data)).toEqual(['a2']);
    expect(ring.since(init, b)).toBeNull();
    expect(ring.since(other, b)).toEqual([]);
  });

  it('holds 2000 entries by default', () => {
    const ring = new Ring();
    const first = ring.push('0', null);
    for (let i = 1; i < 2000; i++) ring.push(String(i), null);
    expect(ring.since(first - 1, null)).toHaveLength(2000);
    ring.push('x', null);
    expect(ring.since(first - 1, null)).toBeNull();
    expect(ring.since(first, null)).toHaveLength(2000);
  });
});

describe('RingGate', () => {
  const setup = () => {
    let t = 1_000_000;
    const viewers = new Set<string>();
    const ring = new Ring(50);
    const gate = new RingGate(ring, (c) => viewers.has(c), () => t);
    return { ring, gate, viewers, advance: (ms: number) => (t += ms) };
  };

  it('skips appends for an unwatched chat and rings one marker', () => {
    const { ring, gate } = setup();
    const start = ring.seq;
    const mark = ring.push('x', 'other');
    expect(gate.push('a1', 'a')).toBeUndefined();
    const afterMarker = ring.seq;
    expect(gate.push('a2', 'a')).toBeUndefined();
    expect(ring.seq).toBe(afterMarker);
    expect(ring.since(start, 'a')).toBeNull();
    expect(ring.since(start, 'other')?.map((e) => e.data)).toEqual(['x']);
    expect(ring.since(mark, 'other')).toEqual([]);
  });

  it('rings appends for a viewed chat and chat-less messages and init anywhere', () => {
    const { ring, gate, viewers } = setup();
    viewers.add('a');
    const start = ring.seq;
    expect(gate.push('a1', 'a')).toBeDefined();
    expect(gate.push('live', null)).toBeDefined();
    expect(gate.push(null, 'b')).toBeDefined();
    expect(ring.since(start, 'a')?.map((e) => e.data)).toEqual(['a1', 'live']);
    expect(ring.since(start, 'b')).toBeNull();
  });

  it('keeps a chat watched for the grace window and prunes after it', () => {
    const { ring, gate, advance } = setup();
    gate.leave('a');
    advance(GRACE_MS - 1);
    const start = ring.seq;
    gate.push('a1', 'a');
    expect(ring.since(start, 'a')?.map((e) => e.data)).toEqual(['a1']);
    advance(2);
    gate.push('a2', 'a');
    expect(gate.graced).toBe(0);
    expect(ring.since(start, 'a')).toBeNull();
  });

  it('rings a marker again after a client attaches', () => {
    const { ring, gate } = setup();
    gate.push('a1', 'a');
    gate.attach('a');
    const before = ring.seq;
    gate.push('a2', 'a');
    expect(ring.seq).toBe(before + 1);
  });
});
