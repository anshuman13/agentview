import { describe, expect, test } from 'vitest';
import { pickReports, reviewStart } from './reports';

const e = (key: string, at: number, candidate = true) => ({ key, at, candidate });

describe('reviewStart', () => {
  test('is the Friday 14:00 of the review window', () => {
    const fri = new Date(2026, 10, 6, 14).getTime();
    expect(reviewStart(new Date(2026, 10, 6, 15).getTime())).toBe(fri);
    expect(reviewStart(new Date(2026, 10, 7, 9).getTime())).toBe(fri);
    expect(reviewStart(new Date(2026, 10, 8, 9).getTime())).toBe(fri);
  });
});

describe('pickReports', () => {
  const list = [e('brief', 8), e('digest', 17), e('job', 12, false), e('week', 14)];

  test('newest candidate is the card, rows follow newest first', () => {
    const r = pickReports(list, null, []);
    expect(r.card?.key).toBe('digest');
    expect(r.rows.map((x) => x.key)).toEqual(['week', 'job', 'brief']);
  });

  test('a job is never the card', () => {
    const r = pickReports([e('job', 5, false)], null, []);
    expect(r.card).toBeNull();
    expect(r.rows).toHaveLength(1);
  });

  test('opening a row swaps it with the card', () => {
    const r = pickReports(list, 'brief', []);
    expect(r.card?.key).toBe('brief');
    expect(r.rows.map((x) => x.key)).toContain('digest');
  });

  test('a closed card has no row and leaves no card', () => {
    const r = pickReports(list, null, ['digest']);
    expect(r.card).toBeNull();
    expect(r.rows.map((x) => x.key)).toEqual(['week', 'job', 'brief']);
  });

  test('a closed opened card is gone and the next stays a row', () => {
    const r = pickReports(list, 'brief', ['brief']);
    expect(r.card).toBeNull();
    expect(r.rows.map((x) => x.key)).not.toContain('brief');
  });

  test('rows cap at 5 unless all, the card does not count', () => {
    const many = [e('c', 100), ...Array.from({ length: 7 }, (_, i) => e(`j${i}`, i, false))];
    const r = pickReports(many, null, []);
    expect(r.card?.key).toBe('c');
    expect(r.rows).toHaveLength(5);
    expect(r.total).toBe(7);
    expect(pickReports(many, null, [], true).rows).toHaveLength(7);
  });
});
