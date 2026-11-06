import { describe, expect, it } from 'vitest';
import { goalsMeta } from './Goals';

describe('goalsMeta', () => {
  it('counts goals and names those at risk', () => {
    expect(goalsMeta(3, 1)).toBe('3 goals · 1 at risk');
    expect(goalsMeta(1, 0)).toBe('1 goal');
    expect(goalsMeta(2, 2)).toBe('2 goals · 2 at risk');
  });
});
