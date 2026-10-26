import { describe, expect, it } from 'bun:test';
import { openDb } from './db.js';
import { importDue, saveMeetings } from './calendar.js';

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
});

describe('importDue', () => {
  const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
  it('imports once an hour from 08:00 to 14:00 on weekdays', () => {
    expect(importDue(0, at(26, 7, 59))).toBe(false);
    expect(importDue(0, at(26, 8))).toBe(true);
    expect(importDue(at(26, 8, 5), at(26, 8, 50))).toBe(false);
    expect(importDue(at(26, 8, 5), at(26, 9, 10))).toBe(true);
    expect(importDue(at(26, 13), at(26, 14, 30))).toBe(true);
    expect(importDue(0, at(26, 15))).toBe(false);
    expect(importDue(0, at(25, 10))).toBe(false);
  });
});
