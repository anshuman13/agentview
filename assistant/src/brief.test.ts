import { expect, it } from 'bun:test';
import { openDb } from './db.js';
import { briefId, buildBrief, runBriefs } from './brief.js';

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();
const MON = 2;

function seed() {
  const db = openDb(':memory:');
  const meeting = db.prepare("INSERT INTO meetings (id, profile, version, updated_at, title, starts_at, ends_at) VALUES (?, 'work', 1, 0, ?, ?, ?)");
  meeting.run('a', 'Standup', at(MON, 9), at(MON, 9, 30));
  meeting.run('b', 'Review', at(MON, 13), at(MON, 14));
  meeting.run('fri', 'Planning', at(MON - 3, 10), at(MON - 3, 11));
  const item = db.prepare("INSERT INTO items (id, profile, version, updated_at, title, source, status, at, meeting_id) VALUES (?, 'work', 1, 0, ?, ?, ?, ?, ?)");
  item.run('t1', 'Send report', 'capture', 'open', at(MON, 7), null);
  item.run('t2', 'Call bank', 'capture', 'open', at(MON, 15), null);
  item.run('t3', 'Tomorrow', 'capture', 'open', at(MON + 1, 9), null);
  item.run('s1', 'Check the numbers', 'slack', 'suggested', null, null);
  item.run('x1', 'Share the plan', 'action', 'open', null, 'fri');
  item.run('x2', 'Done already', 'action', 'done', null, 'fri');
  return db;
}

it('lists meetings, free time, tasks, Slack asks and actions left from Friday', () => {
  const b = buildBrief(seed(), 'work', at(MON, 8));
  expect(b.title).toBe('Today: 2 meetings, 2 tasks');
  expect(b.text.split('\n')).toEqual([
    'Meetings · 2',
    '09:00-09:30 Standup',
    '13:00-14:00 Review',
    'Free 7h30: 08:00-09:00, 09:30-13:00, 14:00-17:00',
    '',
    'Tasks · 2 due today, 1 overdue',
    '- Send report (overdue)',
    '- Call bank',
    '',
    'Slack asks to review · 1',
    '- Check the numbers',
    '',
    'Still open from last workday · 1',
    '- Share the plan (Planning)',
  ]);
  expect(buildBrief(seed(), 'personal', at(MON, 8)).empty).toBe(true);
});

it('counts tasks this week that will not fit before they are due, leaving out blocked ones', () => {
  const db = seed();
  const item = db.prepare("INSERT INTO items (id, profile, version, updated_at, title, source, status, at) VALUES (?, 'work', 1, 0, ?, 'capture', 'open', ?)");
  item.run('big', 'Write the plan ~8h', at(MON + 1, 10));
  item.run('held', 'Draft memo ~8h', at(MON, 12));
  db.prepare("INSERT INTO meetings (id, profile, version, updated_at, title, starts_at, ends_at) VALUES ('block:held', 'work', 1, 0, 'Focus: Draft memo', ?, ?)").run(at(MON, 10), at(MON, 11));
  const lines = buildBrief(db, 'work', at(MON, 8)).text.split('\n');
  expect(lines).toContain('At risk: 1 task');
});

it('stores and pushes once per profile and weekday morning', async () => {
  const db = seed();
  const pushed: string[] = [];
  const push = async (title: string) => (pushed.push(title), true);
  expect(await runBriefs(db, at(MON, 7, 59), push)).toEqual([]);
  expect(await runBriefs(db, at(MON, 8), push)).toEqual(['work']);
  expect(await runBriefs(db, at(MON, 8, 1), push)).toEqual([]);
  expect(pushed).toEqual(['Today: 2 meetings, 2 tasks']);
  expect(db.prepare('SELECT profile, kind FROM briefs WHERE id = ?').all(briefId(at(MON, 8)))).toEqual([{ profile: 'work', kind: 'morning' }]);
  expect(await runBriefs(seed(), at(MON + 1, 11), push)).toEqual([]);
  expect(await runBriefs(seed(), at(MON - 2, 8), push)).toEqual([]);
});

it('retries a failed push without storing the brief twice', async () => {
  const db = seed();
  expect(await runBriefs(db, at(MON, 8), async () => false)).toEqual([]);
  expect(await runBriefs(db, at(MON, 8, 1), async () => true)).toEqual(['work']);
  expect(db.prepare("SELECT to_at FROM briefs WHERE profile = 'work'").all()).toEqual([{ to_at: at(MON, 8) }]);
});

it('sends a brief that was empty at 08:00 once the calendar lands', async () => {
  const db = seed();
  expect(await runBriefs(db, at(MON, 8), async () => true)).toEqual(['work']);
  db.prepare("INSERT INTO meetings (id, profile, version, updated_at, title, starts_at, ends_at) VALUES ('p', 'personal', 1, 0, 'Dentist', ?, ?)").run(at(MON, 16), at(MON, 17));
  expect(await runBriefs(db, at(MON, 9), async () => true)).toEqual(['personal']);
});
