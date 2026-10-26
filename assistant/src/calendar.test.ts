import { describe, expect, it } from 'bun:test';
import { openDb } from './db.js';
import { applyChanges } from './sync.js';
import { importDue, lastImport, saveMeetings, syncCalendar } from './calendar.js';

const ev = (id: string, start: string) => ({ id, title: `M ${id}`, start, end: start.replace('T09', 'T10'), people: ['Kari'] });

describe('saveMeetings', () => {
  it('adds, skips unchanged, and removes gone meetings without notes', () => {
    const db = openDb(':memory:');
    const from = Date.parse('2026-10-26T00:00:00Z'), to = from + 9 * 86400_000;
    expect(saveMeetings(db, 'work', [ev('a', '2026-10-27T09:00:00Z'), ev('b', '2026-10-28T09:00:00Z')], from, to, 1)).toBe(2);
    expect(saveMeetings(db, 'work', [ev('a', '2026-10-27T09:00:00Z'), ev('b', '2026-10-28T09:00:00Z')], from, to, 2)).toBe(0);
    db.prepare("UPDATE meetings SET notes = 'mine' WHERE id = 'cal:b'").run();
    expect(saveMeetings(db, 'work', [ev('c', '2026-10-29T09:00:00Z')], from, to, 3)).toBe(2);
    const rows = db.prepare('SELECT id, deleted, people FROM meetings ORDER BY id').all();
    expect(rows).toEqual([{ id: 'cal:a', deleted: 1, people: '["Kari"]' }, { id: 'cal:b', deleted: 0, people: '["Kari"]' }, { id: 'cal:c', deleted: 0, people: '["Kari"]' }]);
  });

  it('brings back a removed meeting when its event reappears, but not one I deleted', () => {
    const db = openDb(':memory:');
    const from = Date.parse('2026-10-26T00:00:00Z'), to = from + 9 * 86400_000;
    const a = ev('a', '2026-10-27T09:00:00Z'), b = ev('b', '2026-10-28T09:00:00Z');
    saveMeetings(db, 'work', [a, b], from, to, 1);
    saveMeetings(db, 'work', [b], from, to, 2);
    applyChanges(db, [{ table: 'meetings', id: 'cal:b', profile: 'work', updated_at: 3, deleted: true, fields: {} }]);
    expect(saveMeetings(db, 'work', [a, b], from, to, 4)).toBe(1);
    expect(db.prepare('SELECT id, deleted FROM meetings ORDER BY id').all()).toEqual([{ id: 'cal:a', deleted: 0 }, { id: 'cal:b', deleted: 1 }]);
    expect(saveMeetings(db, 'work', [a, b], from, to, 5)).toBe(0);
  });
});

describe('syncCalendar', () => {
  it('reports failed profiles and records the import only for the others', async () => {
    const db = openDb(':memory:');
    const res = await syncCalendar(() => db, ['work', 'personal'], async (_db, p) => {
      if (p === 'work') throw new Error('limit');
      return 3;
    });
    expect(res).toEqual({ changed: 3, errors: ['work: limit'] });
    expect(lastImport(db, 'work')).toBe(0);
    expect(lastImport(db, 'personal')).toBeGreaterThan(0);
  });
});

describe('importDue', () => {
  const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
  it('imports once per half hour from 07:00 to 19:00 on weekdays', () => {
    expect(importDue(0, at(26, 6, 59))).toBe(false);
    expect(importDue(0, at(26, 7))).toBe(true);
    expect(importDue(at(26, 8, 5), at(26, 8, 25))).toBe(false);
    expect(importDue(at(26, 8, 5), at(26, 8, 35))).toBe(true);
    expect(importDue(at(26, 18, 10), at(26, 18, 40))).toBe(true);
    expect(importDue(0, at(26, 19))).toBe(false);
    expect(importDue(0, at(25, 10))).toBe(false);
  });
});
