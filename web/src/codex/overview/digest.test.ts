import { describe, expect, it } from 'vitest';
import { parseDigest, visibleRows } from './digest';

const row = (outcome: string, i = 0) => ({ id: `${outcome}${i}`, who: 'Ann', chat: '#a', outcome, reason: '', edited: false, url: '' });
const json = (...rows: object[]) => JSON.stringify(rows);

describe('parseDigest', () => {
  it('groups a day digest with failed open and sent and skipped folded', () => {
    const d = parseDigest('day', json(row('sent'), row('failed'), ...Array.from({ length: 9 }, (_, i) => row('skipped', i)), row('waiting')))!;
    expect(d.groups.map((g) => [g.outcome, g.rows.length, g.open])).toEqual([['failed', 1, true], ['sent', 1, false], ['skipped', 9, false]]);
    expect(d.waiting.length).toBe(1);
  });
  it('groups an away digest with escalated open and the rest folded', () => {
    const d = parseDigest('away', json(row('held'), row('escalated'), row('answered'), row('skipped')))!;
    expect(d.groups.map((g) => [g.outcome, g.open])).toEqual([['escalated', true], ['answered', false], ['held', false], ['skipped', false]]);
  });
  it('is null for invalid, empty or missing rows', () => {
    expect(parseDigest('day', '{oops')).toBeNull();
    expect(parseDigest('day', '[]')).toBeNull();
    expect(parseDigest('away', null)).toBeNull();
  });
});

describe('visibleRows', () => {
  const g = { outcome: 'skipped', label: 'Skipped', open: false, rows: Array.from({ length: 9 }, (_, i) => row('skipped', i)) };
  it('shows 3 rows of a folded group until Show all, and every row of an open group', () => {
    expect(visibleRows(g, false).length).toBe(3);
    expect(visibleRows(g, true).length).toBe(9);
    expect(visibleRows({ ...g, open: true }, false).length).toBe(9);
  });
});
