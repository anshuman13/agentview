import { describe, expect, it } from 'vitest';
import { buildCommands } from './Palette';
import { SHORTCUTS } from './Shortcuts';

describe('shortcuts', () => {
  it('lists every palette key and no empty group', () => {
    const keys = new Set(SHORTCUTS.flatMap((g) => g.rows.map((r) => r.key)));
    for (const c of buildCommands([])) if (c.key) expect(keys.has(c.key), c.key).toBe(true);
    for (const g of SHORTCUTS) expect(g.rows.length, g.group).toBeGreaterThan(0);
  });
});
