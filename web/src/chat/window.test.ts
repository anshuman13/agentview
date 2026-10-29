import { describe, expect, it } from 'vitest';
import { ROW_WINDOW, revealMore, windowStart } from './window';

describe('row window', () => {

  it('keeps only the last rows of a long chat', () => {
    const total = 3000;
    const start = windowStart(total, ROW_WINDOW);
    expect(total - start).toBe(ROW_WINDOW);
    expect(start).toBe(2850);
  });

  it('reveals another batch and stops at the total', () => {
    expect(revealMore(150, 3000)).toBe(300);
    expect(revealMore(2900, 3000)).toBe(3000);
    expect(windowStart(3000, 3000)).toBe(0);
  });
});
