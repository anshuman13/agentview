import { describe, expect, it } from 'vitest';
import { MAX, SLOP, TRIGGER, classify, damp, shouldRefresh } from './usePullRefresh';

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

describe('damp and release', () => {
  it('halves travel and clamps to 0..MAX', () => {
    expect(damp(100)).toBe(50);
    expect(damp(-20)).toBe(0);
    expect(damp(1000)).toBe(MAX);
  });
  it('refreshes from 64px of finger travel', () => {
    expect(shouldRefresh(damp(TRIGGER - 1))).toBe(false);
    expect(shouldRefresh(damp(TRIGGER))).toBe(true);
  });
});
