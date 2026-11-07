import { describe, expect, it } from 'vitest';
import { backoff, closeKind } from './termReconnect';

describe('termReconnect', () => {
  it('maps 4404 to gone and every other code to retry', () => {
    expect(closeKind(4404)).toBe('gone');
    for (const c of [1000, 1001, 1005, 1006]) expect(closeKind(c)).toBe('retry');
  });

  it('backs off to 10s and resets', () => {
    const b = backoff();
    expect([1, 2, 3, 4, 5, 6].map(() => b.next())).toEqual([1000, 2000, 4000, 8000, 10000, 10000]);
    b.reset();
    expect(b.next()).toBe(1000);
  });
});
