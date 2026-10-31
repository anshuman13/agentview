import { describe, expect, it } from 'vitest';
import { seriesPoints } from './promSeries.js';

describe('seriesPoints', () => {
  it('reads a matrix result with string values', () => {
    const raw = { status: 'success', data: { resultType: 'matrix', result: [{ metric: {}, values: [[1700000000, '1.5'], [1700000300, '2']] }] } };
    expect(seriesPoints(raw)).toEqual([[1700000000, 1.5], [1700000300, 2]]);
  });
  it('reads millisecond timestamps and drops NaN', () => {
    expect(seriesPoints([{ values: [[1700000000000, '1'], [1700000300, 'NaN'], [1700000600, '3']] }])).toEqual([[1700000000, 1], [1700000600, 3]]);
  });
  it('returns nothing for text', () => {
    expect(seriesPoints('no data')).toEqual([]);
  });
});
