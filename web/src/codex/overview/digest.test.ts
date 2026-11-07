import { describe, expect, it } from 'vitest';
import { visibleRows } from './digest';

const row = (outcome: string, i = 0) => ({ id: `${outcome}${i}`, outcome });

describe('visibleRows', () => {
  const g = { outcome: 'skipped', label: 'Skipped', open: false, rows: Array.from({ length: 9 }, (_, i) => row('skipped', i)) };
  it('shows 3 rows of a folded group until Show all, and every row of an open group', () => {
    expect(visibleRows(g, false).length).toBe(3);
    expect(visibleRows(g, true).length).toBe(9);
    expect(visibleRows({ ...g, open: true }, false).length).toBe(9);
    expect(visibleRows({ ...g, open: true }, false, true).length).toBe(3);
    expect(visibleRows({ ...g, open: true }, true, true).length).toBe(9);
  });
});
