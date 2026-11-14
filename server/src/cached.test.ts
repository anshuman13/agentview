import { describe, expect, it } from 'bun:test';
import { cached } from './cached.js';

describe('cached', () => {
  it('shares one load, drops a failed one and serves a stale value while it refreshes', async () => {
    let n = 0;
    let fail = false;
    const get = cached(async () => {
      if (fail) throw new Error('down');
      return ++n;
    }, 0, true);
    expect(await Promise.all([get(), get()])).toEqual([1, 1]);
    expect(await get()).toBe(1);
    expect(await get()).toBe(2);
    fail = true;
    await expect(get(true)).rejects.toThrow('down');
    expect(await get()).toBe(2);
  });

  it('does not store a load that started before clear', async () => {
    let n = 0;
    const get = cached(async () => ++n, 60_000);
    const first = get();
    get.clear();
    expect(await first).toBe(1);
    expect(await get()).toBe(2);
  });
});
