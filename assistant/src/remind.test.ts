import { expect, it } from 'bun:test';
import { openDb } from './db.js';
import { dueReminders } from './remind.js';

it('reminds before a meeting and about its actions once the transcript is read', () => {
  const db = openDb(':memory:');
  const now = 1_000_000_000;
  const meeting = db.prepare("INSERT INTO meetings (id, profile, version, updated_at, title, starts_at, ends_at, people) VALUES (?, 'work', 1, 0, ?, ?, ?, ?)");
  meeting.run('a', 'Planning', now - 2 * 3600_000, now - 3600_000, 'Kim');
  meeting.run('b', 'Planning', now + 5 * 60_000, now + 3600_000, 'Kim');
  const item = db.prepare("INSERT INTO items (id, profile, version, updated_at, meeting_id, title, source, status) VALUES (?, 'work', 1, 0, 'a', ?, 'action', ?)");
  item.run('x', 'Send the notes', 'open');
  expect(dueReminders(db, now).map((r) => r.title)).toEqual(['Planning in 5 min']);
  item.run('y', 'Book the room', 'suggested');
  db.prepare(`UPDATE meetings SET transcript = 'done', field_times = '{"transcript":${now - 60_000}}' WHERE id = 'a'`).run();
  const due = dueReminders(db, now);
  expect(due.map((r) => r.title)).toEqual(['Planning in 5 min', '2 for you from Planning · 1 to confirm']);
  expect(due[0].body).toContain('Send the notes');
  db.prepare("INSERT INTO meta (key, value) VALUES (?, '1')").run(`remind:${due[1].key}`);
  expect(dueReminders(db, now)).toHaveLength(1);
});

it('reminds about a task when it comes due', () => {
  const db = openDb(':memory:');
  const now = 1_000_000_000;
  const item = db.prepare("INSERT INTO items (id, profile, version, updated_at, title, source, status, at) VALUES (?, 'personal', 1, 0, ?, 'capture', ?, ?)");
  item.run('a', 'Get burger buns', 'open', now - 60_000);
  item.run('b', 'Later', 'open', now + 60_000);
  item.run('c', 'Done already', 'done', now - 60_000);
  item.run('d', 'Long ago', 'open', now - 3600_000);
  expect(dueReminders(db, now).map((r) => r.title)).toEqual(['Get burger buns']);
});

it('reminds once about a meeting in both calendars and keeps open actions to its profile', () => {
  const db = openDb(':memory:');
  const now = 1_000_000_000;
  const meeting = db.prepare("INSERT INTO meetings (id, profile, version, updated_at, title, starts_at, ends_at) VALUES (?, ?, 1, 0, 'Sync', ?, ?)");
  meeting.run('cal:e', 'work', now + 5 * 60_000, now + 3600_000);
  meeting.run('cal:e', 'personal', now + 5 * 60_000, now + 3600_000);
  meeting.run('cal:old', 'personal', now - 7 * 86400_000, now - 7 * 86400_000 + 3600_000);
  db.prepare("INSERT INTO items (id, profile, version, updated_at, meeting_id, title, source, status) VALUES ('x', 'work', 1, 0, 'cal:old', 'Other profile', 'action', 'open')").run();
  const due = dueReminders(db, now);
  expect(due).toHaveLength(1);
  expect(due[0].body).toBe('');
});
