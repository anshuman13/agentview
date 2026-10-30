import { describe, expect, it } from 'vitest';
import { estimateMin, workGaps } from './plan';

const at = (h: number, m = 0) => new Date(2026, 9, 30, h, m).getTime();

describe('estimateMin', () => {
  it('reads minutes, hours and both', () => {
    expect(estimateMin('Write doc ~30m')).toBe(30);
    expect(estimateMin('Review ~1h')).toBe(60);
    expect(estimateMin('Plan ~1h30m')).toBe(90);
    expect(estimateMin('Plan ~1h 30m')).toBe(90);
  });
  it('ignores titles without an estimate', () => {
    expect(estimateMin('About 30m of work')).toBeNull();
    expect(estimateMin('Fix ~0m')).toBeNull();
    expect(estimateMin(null)).toBeNull();
  });
});

describe('workGaps', () => {
  it('counts a running meeting only from now and clips to work hours', () => {
    const busy: [number, number][] = [[at(9), at(11)], [at(10, 30), at(12)], [at(14), at(18)]];
    expect(workGaps(busy, at(11), 8, 17)).toEqual([[at(12), at(14)]]);
  });
  it('starts at 08:00 before work and drops short gaps', () => {
    expect(workGaps([[at(8, 10), at(17)]], at(6))).toEqual([]);
    expect(workGaps([[at(9), at(17)]], at(6))).toEqual([[at(8), at(9)]]);
  });
});
