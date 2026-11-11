import { describe, expect, it, vi } from 'bun:test';
import { createStore } from './createStore';

describe('createStore', () => {
  it('returns the initial state', () => {
    expect(createStore({ a: 1 }).get()).toEqual({ a: 1 });
  });

  it('set replaces without merging', () => {
    const s = createStore<{ a?: number; b?: number } | number[] | null>({ a: 1 });
    s.set({ b: 2 });
    expect(s.get()).toEqual({ b: 2 });
    s.set([1]);
    expect(s.get()).toEqual([1]);
    s.set(null);
    expect(s.get()).toBeNull();
  });

  it('patch merges into a new object', () => {
    const s = createStore({ a: 1, b: 2 });
    const before = s.get();
    s.patch({ a: 3 });
    expect(s.get()).toEqual({ a: 3, b: 2 });
    expect(s.get()).not.toBe(before);
  });

  it('notifies once per change, every subscriber, until unsubscribed', () => {
    const s = createStore(0);
    const a = vi.fn();
    const b = vi.fn();
    const offA = s.subscribe(a);
    s.subscribe(b);
    s.set(1);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    offA();
    s.set(2);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('skips same-reference set and no-change patch, notifies on deep-equal new object', () => {
    const obj = { a: 1 };
    const s = createStore(obj);
    const fn = vi.fn();
    s.subscribe(fn);
    s.set(obj);
    s.patch({ a: 1 });
    expect(fn).not.toHaveBeenCalled();
    s.set({ a: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
