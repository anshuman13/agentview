import { describe, expect, test } from 'bun:test';
import { openDb } from './db.js';
import { applyChanges } from './sync.js';
import { pendingCaptures, saveTidied } from './tidy.js';

const capture = (id: string, t: number, fields: Record<string, string | number | null> = {}) => ({
  table: 'items', id, profile: 'personal' as const, updated_at: t, fields: { title: 'call bank card thing', source: 'capture', status: 'open', at: null, ...fields },
});

describe('tidy', () => {
  test('tidies fresh unedited captures once, and keeps a due time the app found', () => {
    const db = openDb(':memory:');
    const now = Date.UTC(2026, 9, 26, 12);
    applyChanges(db, [capture('a', now - 1000), capture('b', now - 1000, { at: now + 3600_000 }), capture('old', now - 2 * 86400_000), { ...capture('c', now - 1000), fields: { ...capture('c', 0).fields, source: 'action' } }]);
    applyChanges(db, [{ table: 'items', id: 'b', profile: 'personal', updated_at: now - 500, fields: { title: 'my own edit' } }]);
    const pending = pendingCaptures(db, 'personal', now);
    expect(pending.map((c) => c.id)).toEqual(['a']);
    saveTidied(db, 'personal', pending, [{ id: 'a', title: 'Call the bank about the card', details: null, due: '2026-10-27' }], now);
    const a = db.prepare("SELECT title, at FROM items WHERE id = 'a'").get() as { title: string; at: number };
    expect(a.title).toBe('Call the bank about the card');
    expect(a.at).toBe(new Date(2026, 9, 27, 9).getTime());
    expect(pendingCaptures(db, 'personal', now)).toEqual([]);
  });
});
