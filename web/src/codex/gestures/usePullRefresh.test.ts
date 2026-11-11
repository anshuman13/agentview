import { describe, expect, it } from 'bun:test';
import { SLOP, classify } from './usePullRefresh';

describe('classify', () => {
  it('waits while both axes are under the slop', () => {
    expect(classify(0, SLOP - 1, 0)).toBe('wait');
    expect(classify(SLOP - 1, SLOP - 1, 0)).toBe('wait');
    expect(classify(0, SLOP, 0)).toBe('pull');
  });
  it('pulls downward, cancels sideways and upward', () => {
    expect(classify(2, 30, 0)).toBe('pull');
    expect(classify(30, 12, 0)).toBe('cancel');
    expect(classify(0, -30, 0)).toBe('cancel');
    expect(classify(12, 9, 0)).toBe('cancel');
    expect(classify(0, 30, 5)).toBe('cancel');
  });
});
