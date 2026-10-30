import { describe, expect, it } from 'vitest';
import { revealMore, windowStart } from './window';

describe('row window', () => {
  it('reveals another batch and stops at the total', () => {
    expect(revealMore(150, 3000)).toBe(300);
    expect(revealMore(2900, 3000)).toBe(3000);
    expect(windowStart(3000, 3000)).toBe(0);
  });
});
