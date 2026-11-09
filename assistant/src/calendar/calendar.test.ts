import { describe, expect, it } from 'bun:test';
import { openDb } from '../core/db.js';
import { applyChanges } from '../core/sync.js';
import { calendarPrompt, eventUrl, importDue, lastImport, saveMeetings, syncCalendar } from './calendar.js';

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

  it('keeps web links from the event and skips unchanged ones', () => {
    const db = openDb(':memory:');
    const from = Date.parse('2026-10-26T00:00:00Z'), to = from + 9 * 86400_000;
    const a = { ...ev('a', '2026-10-27T09:00:00Z'), links: [{ title: 'AIE-1 Fix', url: 'https://linear.app/x' }, { title: 'Bad', url: 'javascript:x' }] };
    expect(saveMeetings(db, 'work', [a], from, to, 1)).toBe(1);
    expect(saveMeetings(db, 'work', [a], from, to, 2)).toBe(0);
    expect(db.prepare('SELECT links FROM meetings').get()).toEqual({ links: '[{"title":"AIE-1 Fix","url":"https://linear.app/x"}]' });
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

  it('ignores attendee names turned into emails and slips in the event link', () => {
    const db = openDb(':memory:');
    const from = Date.parse('2026-10-26T00:00:00Z'), to = from + 9 * 86400_000;
    const url = `https://www.google.com/calendar/event?eid=${Buffer.from('a kari@example.com').toString('base64url')}`;
    const a = { ...ev('a', '2026-10-27T09:00:00Z'), url };
    expect(saveMeetings(db, 'work', [a], from, to, 1)).toBe(1);
    expect(saveMeetings(db, 'work', [{ ...a, people: ['kari@example.com'], url: `${url}&ctz=UTC` }], from, to, 2)).toBe(0);
    expect(saveMeetings(db, 'work', [{ ...a, people: ['Kari', 'Ola'] }], from, to, 3)).toBe(1);
    expect(eventUrl('a', url)).toBe(url);
  });
});

describe('saveMeetings organizer', () => {
  it('stores the organiser, keeps it on null and counts a change as an update', () => {
    const db = openDb(':memory:');
    const from = Date.parse('2026-10-26T00:00:00Z'), to = from + 9 * 86400_000;
    const a = ev('a', '2026-10-27T09:00:00Z');
    const mine = () => db.prepare("SELECT organizer_me AS o FROM meetings WHERE id = 'cal:a'").get();
    saveMeetings(db, 'work', [{ ...a, organizer: true }], from, to, 1);
    expect(mine()).toEqual({ o: 1 });
    expect(saveMeetings(db, 'work', [{ ...a, organizer: null }], from, to, 2)).toBe(0);
    expect(mine()).toEqual({ o: 1 });
    expect(saveMeetings(db, 'work', [{ ...a, organizer: false }], from, to, 3)).toBe(1);
    expect(mine()).toEqual({ o: 0 });
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

describe('calendarPrompt', () => {
  it('keeps solo events for personal and leaves them out for work', () => {
    const personal = calendarPrompt('personal', 0, 1), work = calendarPrompt('work', 0, 1);
    expect(personal).toContain('Keep timed events with no other attendees');
    expect(personal).toContain('all-day');
    expect(personal).toContain('declined');
    expect(personal).not.toContain('and events with no other attendees');
    expect(work).toContain('events I declined, and events with no other attendees.');
  });

  it('saves a solo event once', () => {
    const db = openDb(':memory:');
    const from = Date.parse('2026-10-26T00:00:00Z'), to = from + 9 * 86400_000;
    const solo = { ...ev('s', '2026-10-27T09:00:00Z'), people: [] };
    expect(saveMeetings(db, 'personal', [solo], from, to, 1)).toBe(1);
    expect(saveMeetings(db, 'personal', [solo], from, to, 2)).toBe(0);
    expect(db.prepare("SELECT id, people FROM meetings WHERE id = 'cal:s'").get()).toEqual({ id: 'cal:s', people: '[]' });
  });
});
