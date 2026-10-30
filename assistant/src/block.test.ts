import { expect, it } from 'bun:test';
import { openDb } from './db.js';
import { addBlock, eventIdOf, onlyEvent } from './block.js';

it('creates the event only for an open task, then moves the task and keeps the block', async () => {
  const db = openDb(':memory:');
  const item = db.prepare("INSERT INTO items (id, profile, version, updated_at, title, status) VALUES (?, 'work', 1, 0, ?, ?)");
  item.run('a', 'Write doc ~30m', 'open');
  item.run('b', 'Old', 'done');
  const made: string[] = [];
  const olds: (string | null)[] = [];
  const link = `https://www.google.com/calendar/event?eid=${Buffer.from('abc123 me@example.com').toString('base64url')}`;
  const create = async (b: { id: string }, old: string | null) => (made.push(b.id), olds.push(old), { url: link });
  const block = (id: string, start: number, end: number) => addBlock(() => db, { profile: 'work', id, start, end, title: 'Focus: x' }, create, () => 5);
  await expect(block('b', 1000, 2000)).rejects.toThrow('No such open task');
  await expect(block('a', 2000, 1000)).rejects.toThrow('Invalid start or end');
  expect(made).toEqual([]);
  await block('a', 1000, 2000);
  expect(made).toEqual(['a']);
  expect(db.prepare("SELECT at FROM items WHERE id = 'a'").get()).toEqual({ at: 1000 });
  expect(db.prepare("SELECT title, starts_at, ends_at, calendar_url FROM meetings WHERE id = 'block:a'").get()).toEqual({ title: 'Focus: x', starts_at: 1000, ends_at: 2000, calendar_url: link });
  await block('a', 3000, 4000);
  expect(olds).toEqual([null, 'abc123']);
});

it('reads the event id from a calendar link and lets only that event be deleted', () => {
  expect(eventIdOf(`https://calendar.google.com/calendar/event?eid=${Buffer.from('ev_20261030T090000Z me@example.com').toString('base64url')}`)).toBe('ev_20261030T090000Z');
  expect(eventIdOf('https://cal/e')).toBe(null);
  expect(eventIdOf(null)).toBe(null);
  const verdict = (input: object, id: string | null) => onlyEvent({ hook_event_name: 'PreToolUse', tool_input: input } as never, id);
  expect(verdict({ eventId: 'abc' }, 'abc')).toMatchObject({ hookSpecificOutput: { permissionDecision: 'allow' } });
  expect(verdict({ eventId: 'other' }, 'abc')).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
  expect(verdict({ eventId: 'abc', calendarId: 'team@example.com' }, 'abc')).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
  expect(verdict({ eventId: 'abc' }, null)).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
});
