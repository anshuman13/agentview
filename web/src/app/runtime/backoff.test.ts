import { describe, expect, it } from 'vitest';
import { backoffDelay } from './backoff';

const steps = [1000, 2000, 4000, 8000, 15000, 15000];

describe('backoffDelay', () => {
  it('steps up to the 15 s cap', () => {
    expect(steps.map((_, i) => backoffDelay(i, () => 0.5))).toEqual(steps);
    expect(backoffDelay(100, () => 0.5)).toBe(15000);
  });
  it('jitters within 20%', () => {
    steps.forEach((s, i) => {
      expect(backoffDelay(i, () => 0)).toBeCloseTo(s * 0.8);
      expect(backoffDelay(i, () => 1)).toBeCloseTo(s * 1.2);
    });
    expect(backoffDelay(100, () => 1)).toBeLessThanOrEqual(18000);
  });
  it('treats negative and fractional attempts as whole steps from 0', () => {
    expect(backoffDelay(-3, () => 0.5)).toBe(1000);
    expect(backoffDelay(1.9, () => 0.5)).toBe(2000);
  });
});
