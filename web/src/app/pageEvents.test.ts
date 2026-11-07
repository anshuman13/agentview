import { describe, expect, it } from 'vitest';
import { initPage, mergeTail, prependPage } from './pageEvents';
import type { ChatEvent } from '../../../shared/protocol';

const ev = (i: number, text = ''): ChatEvent => ({ id: `e${i}`, kind: 'user', text, at: i });
const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => ev(from + i));

describe('mergeTail', () => {
  it('keeps paged older events after a reconnect init', () => {
    const m = mergeTail(range(100, 400), range(250, 400), 250);
    expect(m.events.map((e) => e.id)).toEqual(range(100, 400).map((e) => e.id));
    expect(m.earlier).toBe(100);
  });

  it('lets the init win on conflict and drops held events it lacks', () => {
    const held = [ev(1), ev(2), ev(3, 'old'), ev(4)];
    const m = mergeTail(held, [ev(3, 'new'), ev(5)], 2);
    expect(m.events.map((e) => e.id)).toEqual(['e1', 'e2', 'e3', 'e5']);
    expect(m.events[2].kind === 'user' && m.events[2].text).toBe('new');
    expect(m.earlier).toBe(0);
  });

  it('keeps nothing when the first id is not held', () => {
    const m = mergeTail(range(100, 200), range(300, 350), 300);
    expect(m.events.map((e) => e.id)).toEqual(range(300, 350).map((e) => e.id));
    expect(m.earlier).toBe(300);
  });
});

describe('initPage', () => {
  it('replaces the events and zeroes earlier for an init without earlier', () => {
    const m = initPage(range(0, 400), true, range(0, 10));
    expect(m.events).toHaveLength(10);
    expect(m.earlier).toBe(0);
  });

  it('replaces for another chat even with earlier', () => {
    const m = initPage(range(0, 400), false, range(250, 400), 250);
    expect(m.events).toHaveLength(150);
    expect(m.earlier).toBe(250);
  });

  it('merges a tail init for the same chat', () => {
    expect(initPage(range(100, 400), true, range(250, 400), 250).earlier).toBe(100);
  });
});

describe('prependPage', () => {
  it('prepends while the held events start at the asked id and drops the page after an init moved them', () => {
    expect(prependPage(range(5, 10), 'e5', range(0, 5), 0)?.events.map((e) => e.id)).toEqual(range(0, 10).map((e) => e.id));
    expect(prependPage(range(0, 10), 'e5', range(0, 5), 0)).toBeNull();
  });
});
