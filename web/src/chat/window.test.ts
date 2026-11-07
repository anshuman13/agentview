import { describe, expect, it } from 'vitest';
import { hiddenCount, revealMore, windowStart } from './window';

describe('row window', () => {
  it('reveals another batch and stops at the total', () => {
    expect(revealMore(150, 3000)).toBe(300);
    expect(revealMore(2900, 3000)).toBe(3000);
    expect(windowStart(3000, 3000)).toBe(0);
  });
});

describe('hidden count', () => {
  it('adds the events left out of the init to the rows the window hides', () => {
    expect(hiddenCount(250, 150, 150)).toBe(250);
    expect(hiddenCount(250, 200, 150)).toBe(300);
    expect(hiddenCount(0, 100, 150)).toBe(0);
  });
});
