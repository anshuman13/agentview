import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FEATURE_IDS } from './featureUse';
import list from './parity.json';

type Entry = { id: string; side: 'web' | 'android'; reason: string };

export function parity(webIds: Set<string>, androidIds: Set<string>, entries: Entry[]): string[] {
  const out: string[] = [];
  for (const [side, ids] of [['web', webIds], ['android', androidIds]] as const) {
    for (const id of ids) if (!FEATURE_IDS.has(id)) out.push(`${id} on ${side} is not in FEATURES`);
  }
  const listed = new Map(entries.map((e) => [e.id, e]));
  for (const id of new Set([...webIds, ...androidIds])) {
    const web = webIds.has(id);
    if (web === androidIds.has(id)) continue;
    if (!listed.has(id)) out.push(`Add ${id} to ${web ? 'Android' : 'web'}, or to parity.json with a reason`);
  }
  for (const e of entries) {
    const web = webIds.has(e.id);
    const android = androidIds.has(e.id);
    if (web === android) out.push(`${e.id} is on ${web ? 'both sides' : 'neither side'}, remove it from parity.json`);
    else if ((e.side === 'web') !== web) out.push(`${e.id} is listed as ${e.side} only but is on the other side`);
  }
  return out;
}

const root = join(import.meta.dir, '..');

function scan(dir: string, pattern: RegExp): Set<string> {
  const ids = new Set<string>();
  const walk = (d: string) => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, f.name);
      if (f.isDirectory()) { if (f.name !== 'test') walk(p); }
      else if (!/\.test\./.test(f.name)) for (const m of readFileSync(p, 'utf8').matchAll(pattern)) ids.add(m[1]);
    }
  };
  walk(join(root, dir));
  return ids;
}

describe('parity', () => {
  const entry = { id: 'sheet:goal', side: 'web' as const, reason: 'x' };
  it('fails an id on one side that is not listed', () => {
    expect(parity(new Set(['sheet:goal']), new Set(), [])).toEqual(['Add sheet:goal to Android, or to parity.json with a reason']);
    expect(parity(new Set(['sheet:goal']), new Set(), [entry])).toEqual([]);
  });
  it('fails a listed id that is on both sides, neither side or the other side', () => {
    expect(parity(new Set(['sheet:goal']), new Set(['sheet:goal']), [entry]).length).toBe(1);
    expect(parity(new Set(), new Set(), [entry]).length).toBe(1);
    expect(parity(new Set(), new Set(['sheet:goal']), [entry]).length).toBe(1);
  });
  it('fails an id that is not in FEATURES', () => {
    expect(parity(new Set(['sheet:nope']), new Set(['sheet:nope']), [])).toHaveLength(2);
  });
  it('holds for the real sources', () => {
    const web = scan('web/src', /\btrack\('([^'$]+)'\)/g);
    const android = scan('android/app/src/main', /\btrack\("([^"$]+)"\)/g);
    expect(parity(web, android, list as Entry[])).toEqual([]);
  });
});
