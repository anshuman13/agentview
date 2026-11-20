import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { buildCommands } from '../palette/paletteLogic';
import { SHORTCUTS } from './Shortcuts';

describe('shortcuts', () => {
  it('lists every palette key and no empty group', () => {
    const keys = new Set(SHORTCUTS.flatMap((g) => g.rows.map((r) => r.key)));
    for (const c of buildCommands([], true)) if (c.key) expect(keys.has(c.key), c.key).toBe(true);
    for (const g of SHORTCUTS) expect(g.rows.length, g.group).toBeGreaterThan(0);
  });

  it('lists the same keys as the docs Shortcuts table', () => {
    const doc = readFileSync(new URL('../../../../docs/features.md', import.meta.url), 'utf8');
    const table = doc.split('\n## Shortcuts\n')[1].split('\n## ')[0];
    const documented = table.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Key |') && !l.startsWith('| ---')).map((l) => l.slice(2).split(' | ')[0]);
    expect(documented.length).toBeGreaterThan(10);
    expect(new Set(documented)).toEqual(new Set(SHORTCUTS.flatMap((g) => g.rows.map((r) => r.key))));
  });
});
