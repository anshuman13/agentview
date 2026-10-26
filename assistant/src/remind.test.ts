import { expect, it } from 'bun:test';
import { openDb } from './db.js';
import { dueReminders } from './remind.js';

it('reminds before a meeting and about its open actions after', () => {
  const db = openDb(':memory:');
  const now = 1_000_000_000;
  const meeting = db.prepare("INSERT INTO meetings (id, profile, version, updated_at, title, starts_at, ends_at, people) VALUES (?, 'work', 1, 0, ?, ?, ?, ?)");
  meeting.run('a', 'Planning', now - 2 * 3600_000, now - 3600_000, 'Kim');
  meeting.run('b', 'Planning', now + 5 * 60_000, now + 3600_000, 'Kim');
  db.prepare("INSERT INTO actions (id, profile, version, updated_at, meeting_id, title, status) VALUES ('x', 'work', 1, 0, 'a', 'Send the notes', 'proposed')").run();
  const due = dueReminders(db, now);
  expect(due.map((r) => r.title)).toEqual(['Planning in 5 min', '1 action from Planning needs you']);
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
