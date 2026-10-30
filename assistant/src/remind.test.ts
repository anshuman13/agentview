import { expect, it } from 'bun:test';
import { openDb } from './db.js';
import { dueReminders, finishTask, snoozeTask } from './remind.js';
import { heldDue, meetingAt, pushOrHold } from './hold.js';

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
  db.prepare("INSERT INTO items (id, profile, version, updated_at, title, status, at) VALUES ('e', 'work', 1, 0, 'No source', 'open', ?)").run(now - 60_000);
  expect(dueReminders(db, now).map((r) => r.title)).toEqual(['Get burger buns', 'No source']);
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

it('adds the last decisions and open questions to the heads-up', () => {
  const db = openDb(':memory:');
  const now = 1_000_000_000;
  const meeting = db.prepare("INSERT INTO meetings (id, profile, version, updated_at, title, starts_at, ends_at, summary, decisions, calendar_url) VALUES (?, 'work', 1, 0, 'Sync', ?, ?, ?, ?, ?)");
  meeting.run('a', now - 7 * 86400_000, now - 7 * 86400_000 + 3600_000, 'We shipped it. Who owns the rollout?', '["Use Postgres","Drop the cache","Ship Friday","Fourth"]', null);
  meeting.run('b', now + 5 * 60_000, now + 3600_000, null, null, 'https://cal.example/b');
  const [r] = dueReminders(db, now);
  expect(r.body).toBe('Decided last time:\n- Use Postgres\n- Drop the cache\n- Ship Friday\nOpen questions:\n- Who owns the rollout?');
  expect(r.actions).toBe('view, Open, https://cal.example/b');
});

it('gives the due push Done and Snooze that sync', () => {
  const db = openDb(':memory:');
  const now = 1_000_000_000;
  db.prepare("INSERT INTO items (id, profile, version, updated_at, title, text, source, status, at, rolls, rolled_from) VALUES ('t', 'personal', 1, 0, 'Call', '\nFirst line\nsecond', 'capture', 'open', ?, 2, 5)").run(now - 60_000);
  const [r] = dueReminders(db, now);
  expect(r.body.split('\n')[1]).toBe('First line');
  expect(r.actions).toContain('/task/done?profile=personal&id=t');
  expect(r.actions).toContain('/task/snooze?profile=personal&id=t');
  expect(snoozeTask(db, 'personal', 't', now)).toBe(true);
  const row = db.prepare("SELECT at, rolls, rolled_from, field_times FROM items WHERE id = 't'").get() as { at: string | number; rolls: number | null; rolled_from: number | null; field_times: string };
  expect([Number(row.at), row.rolls, row.rolled_from, JSON.parse(row.field_times).at]).toEqual([now + 3600_000, null, null, now]);
  expect(finishTask(db, 'personal', 't', now)).toBe(true);
  expect((db.prepare("SELECT status FROM items WHERE id = 't'").get() as { status: string }).status).toBe('done');
  expect(finishTask(db, 'work', 't', now)).toBe(false);
});

it('holds urgent pushes during a meeting and combines them once it ends', async () => {
  const db = openDb(':memory:');
  const now = 1_000_000_000;
  const meeting = db.prepare("INSERT INTO meetings (id, profile, version, updated_at, title, starts_at, ends_at) VALUES (?, 'work', 1, 0, ?, ?, ?)");
  meeting.run('block:t1', 'Focus', now - 60_000, now + 3600_000);
  meeting.run('cal:day', 'Offsite', now - 3600_000, now + 23 * 3600_000);
  db.prepare("INSERT INTO meetings (id, profile, version, updated_at, title, starts_at, ends_at, people) VALUES ('cal:focus', 'work', 1, 0, 'Focus: Write', ?, ?, '[]')").run(now - 60_000, now + 3600_000);
  expect(meetingAt(db, now)).toBeUndefined();
  meeting.run('cal:sync', 'Sync', now - 60_000, now + 1800_000);
  await pushOrHold(db, 'Kim: Review the plan', '#team', 'quote', '', '', now);
  await pushOrHold(db, 'Bo: Sign the form', 'Gmail', 'quote', '', '', now + 60_000);
  expect(heldDue(db, now + 120_000)).toBeNull();
  expect(heldDue(db, now + 1800_000)).toEqual({ count: 2, title: '2 urgent while you were in Sync', body: '- Kim: Review the plan (#team)\n- Bo: Sign the form (Gmail)' });
});
