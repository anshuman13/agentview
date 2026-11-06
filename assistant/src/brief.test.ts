import { expect, it } from 'bun:test';
import { openDb } from './db.js';
import { aheadDay, briefId, buildBrief, runAhead, runBriefs } from './brief.js';

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
  db.prepare('UPDATE items SET updated_at = ?, people = ? WHERE id = ?').run(at(MON - 3, 10), 'Per · #ai-help', 's1');
  item.run('said:s2', 'Send the slides', 'slack', 'suggested', null, null);
  item.run('x1', 'Share the plan', 'action', 'open', null, 'fri');
  item.run('x2', 'Done already', 'action', 'done', null, 'fri');
  return db;
}

it('lists meetings, free time, tasks, Slack asks, my promises and actions left from Friday', () => {
  const b = buildBrief(seed(), 'work', at(MON, 8));
  expect(b.title).toBe('Today: 2 meetings, 2 tasks');
  expect(b.text.split('\n')).toEqual([
    'Meetings · 2',
    '09:00-09:30 Standup',
    '13:00-14:00 Review',
    'Free 7h30: 08:00-09:00, 09:30-13:00, 14:00-17:00',
    '',
    'Tasks · 2 due today, 1 undated, 1 overdue',
    '- Send report (overdue)',
    '- Call bank',
    '- Share the plan',
    '',
    'Waiting from yesterday or older · 1',
    '- Check the numbers (Per, 2 days)',
    '',
    'You said · 1',
    '- Send the slides',
    '',
    'Still open from last workday · 1',
    '- Share the plan (Planning)',
  ]);
  expect(buildBrief(seed(), 'personal', at(MON, 8)).empty).toBe(true);
});

it('lists tasks without a due time after dated ones and never marks them overdue', () => {
  const db = seed();
  const item = db.prepare("INSERT INTO items (id, profile, version, updated_at, title, source, status, at) VALUES (?, 'work', 1, 0, ?, 'capture', 'open', ?)");
  item.run('n1', 'No date', null);
  item.run('n2', 'Empty date', '');
  const b = buildBrief(db, 'work', at(MON, 8));
  expect(b.title).toBe('Today: 2 meetings, 2 tasks');
  expect(b.text).toContain('Tasks · 2 due today, 3 undated, 1 overdue');
  expect(b.text).toContain('- Call bank\n- Share the plan\n- No date\n- Empty date');
});

it('counts tasks this week that will not fit before they are due, leaving out blocked ones', () => {
  const db = seed();
  const item = db.prepare("INSERT INTO items (id, profile, version, updated_at, title, source, status, at) VALUES (?, 'work', 1, 0, ?, 'capture', 'open', ?)");
  item.run('big', 'Write the plan ~8h', at(MON + 1, 10));
  item.run('held', 'Draft memo ~8h', at(MON, 12));
  item.run('blank', 'Blank date ~8h', '');
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
  expect(await runBriefs(seed(), at(MON + 1, 17), push)).toEqual([]);
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

it('tags tasks rolled over from earlier days and counts them in the header', () => {
  const db = seed();
  db.prepare("UPDATE items SET rolls = 3 WHERE id = 't2'").run();
  const lines = buildBrief(db, 'work', at(MON, 8)).text.split('\n');
  expect(lines).toContain('Tasks · 2 due today, 1 undated, 1 overdue, 1 rolled');
  expect(lines).toContain('- Call bank (rolled 3x)');
});

it('sends a brief at 13:00 when the hub was down all morning', async () => {
  expect(await runBriefs(seed(), at(MON, 13), async () => true)).toEqual(['work']);
});

it('lists only free time still ahead in a brief sent later in the day', () => {
  expect(buildBrief(seed(), 'work', at(MON, 13, 30)).text).toContain('Free 3h: 14:00-17:00');
});

it('sums up the next day with work only when nothing is due today, and again only when it changes', async () => {
  const db = seed();
  expect(aheadDay(db, at(MON, 8))).toBeNull();
  db.prepare("UPDATE items SET status = 'done' WHERE id IN ('t1', 't2')").run();
  const prompts: string[] = [];
  const write = async (p: string) => (prompts.push(p), 'You need to finish the move — then rest.');
  expect(await runAhead(db, at(MON, 18), write)).toBe('You need to finish the move, then rest.');
  expect(prompts[0]).toContain('- Tomorrow');
  expect(db.prepare("SELECT kind, from_at FROM briefs WHERE id = 'ahead:2026-11-03'").get()).toEqual({ kind: 'ahead', from_at: at(MON + 1, 0) });
  expect(await runAhead(db, at(MON, 20), write)).toBeNull();
  expect(prompts).toHaveLength(1);
});

const note = (db: ReturnType<typeof openDb>, id: string, text: string, from: number, deleted = 0) =>
  db.prepare("INSERT INTO briefs (id, profile, version, updated_at, deleted, kind, text, from_at, to_at) VALUES (?, 'work', 1, 0, ?, 'wrapup', ?, ?, ?)").run(id, deleted, text, from, from + 1000);
const FRI = MON - 3;

it('starts the brief with the note from the last workday through Sunday', () => {
  const plain = buildBrief(seed(), 'work', at(MON, 8)).text;
  const db = seed();
  note(db, 'wrapup:fri', 'start with the invoice', at(FRI, 0));
  expect(buildBrief(db, 'work', at(MON, 8)).text).toBe(`Yesterday you noted: start with the invoice\n\n${plain}`);
  note(db, 'wrapup:sun', 'newer', at(MON - 1, 0));
  expect(buildBrief(db, 'work', at(MON, 8)).text.startsWith('Yesterday you noted: newer\n\nMeetings · 2')).toBe(true);
  const skip = seed();
  note(skip, 'wrapup:gone', 'deleted', at(FRI, 0), 1);
  note(skip, 'wrapup:today', 'today', at(MON, 0));
  note(skip, 'wrapup:old', 'old', at(FRI - 1, 0));
  expect(buildBrief(skip, 'work', at(MON, 8)).text).toBe(plain);
  const free = openDb(':memory:');
  note(free, 'wrapup:fri', 'x', at(FRI, 0));
  note(free, 'wrapup:sun', 'y', at(MON - 1, 0));
  expect(buildBrief(free, 'work', at(MON, 8)).text.startsWith('Yesterday you noted: y\n\nFree ')).toBe(true);
});

it('does not make a brief from a note alone', () => {
  const db = openDb(':memory:');
  note(db, 'wrapup:fri', 'x', at(FRI, 0));
  expect(buildBrief(db, 'work', at(MON, 8)).empty).toBe(true);
});

it('stores only the title line as text and the note as the first row, and keeps later notes out', async () => {
  const db = seed();
  note(db, 'wrapup:fri', 'start with the invoice', at(FRI, 0));
  let pushed = 0;
  const push = async () => (pushed++, true);
  await runBriefs(db, at(MON, 8), push);
  const stored = () => db.prepare('SELECT text, rows FROM briefs WHERE id = ?').get(briefId(at(MON, 8))) as { text: string; rows: string };
  expect(stored().text).toBe('Today: 2 meetings, 2 tasks');
  expect(JSON.parse(stored().rows)[0]).toEqual({ section: 'note', title: 'start with the invoice', meta: 'Yesterday you noted', item: '', meeting: '' });
  const before = stored();
  note(db, 'wrapup:mon', 'later', at(MON, 0));
  await runBriefs(db, at(MON, 9), push);
  expect(stored()).toEqual(before);
  expect(pushed).toBe(1);
});

it('returns rows per section with meta, targets and a 20 row cap, and keeps the push text', async () => {
  const db = seed();
  note(db, 'wrapup:fri', 'start with the invoice', at(FRI, 0));
  db.prepare("UPDATE items SET rolls = 3 WHERE id = 't2'").run();
  db.prepare("INSERT INTO items (id, profile, version, updated_at, title, source, status, people) VALUES ('s9', 'work', 1, ?, 'Fresh ask', 'slack', 'suggested', 'Ann · #a')").run(at(MON, 7));
  db.prepare("INSERT INTO items (id, profile, version, updated_at, title, source, status, meeting_id) VALUES ('x3', 'work', 1, 0, 'Maybe mine', 'action', 'suggested', 'fri')").run();
  const b = buildBrief(db, 'work', at(MON, 8));
  const of = (name: string) => b.rows.filter((r) => r.section === name).map(({ section, ...r }) => r);
  const none = { item: '', meeting: '' };
  expect(of('note')).toEqual([{ title: 'start with the invoice', meta: 'Yesterday you noted', ...none }]);
  expect(of('meetings')).toEqual([{ title: 'Standup', meta: '09:00-09:30', item: '', meeting: 'a' }, { title: 'Review', meta: '13:00-14:00', item: '', meeting: 'b' }]);
  expect(of('plan')).toEqual([{ title: 'Free 7h30', meta: '08:00-09:00, 09:30-13:00, 14:00-17:00', ...none }]);
  expect(of('tasks').map((r) => [r.item, r.meta])).toEqual([['t1', 'overdue'], ['t2', 'rolled 3x'], ['x1', '']]);
  expect(of('waiting')).toEqual([{ title: 'Check the numbers', meta: 'Per, 2 days', item: 's1', meeting: '' }]);
  expect(of('asks')).toEqual([{ title: 'Fresh ask', meta: 'Ann, today', item: 's9', meeting: '' }]);
  expect(of('said')).toEqual([{ title: 'Send the slides', meta: '', item: 'said:s2', meeting: '' }]);
  expect(of('left').map((r) => [r.item, r.meta])).toEqual([['x1', 'Planning'], ['x3', 'Planning, yours?']]);
  expect(b.text).toBe(buildBrief(db, 'work', at(MON, 8)).text);
  const many = db.prepare("INSERT INTO items (id, profile, version, updated_at, title, source, status, at) VALUES (?, 'work', 1, 0, ?, 'capture', 'open', ?)");
  for (let i = 0; i < 25; i++) many.run(`m${i}`, `Task ${i}`, at(MON, 10));
  expect(buildBrief(db, 'work', at(MON, 8)).rows.filter((r) => r.section === 'tasks')).toHaveLength(20);
});

it('writes no brief for an empty day and none twice', async () => {
  const db = openDb(':memory:');
  expect(await runBriefs(db, at(MON, 8), async () => true)).toEqual([]);
  expect(db.prepare('SELECT COUNT(*) AS n FROM briefs').get()).toEqual({ n: 0 });
  const full = seed();
  await runBriefs(full, at(MON, 8), async () => true);
  await runBriefs(full, at(MON, 9), async () => true);
  expect(full.prepare("SELECT COUNT(*) AS n FROM briefs WHERE kind = 'morning'").get()).toEqual({ n: 1 });
});

it('prunes the rows of an old morning brief with its text', async () => {
  const db = seed();
  db.prepare("INSERT INTO briefs (id, profile, version, updated_at, kind, text, rows, from_at, to_at) VALUES ('morning:old', 'work', 1, 0, 'morning', 'x', '[{}]', ?, ?)").run(at(MON, 0) - 70 * 86400_000, at(MON, 0) - 70 * 86400_000);
  await runBriefs(db, at(MON, 8), async () => true);
  expect(db.prepare("SELECT deleted, text, rows FROM briefs WHERE id = 'morning:old'").get()).toEqual({ deleted: 1, text: null, rows: null });
});

it('prunes wrapup rows past 60 days only', async () => {
  const db = seed();
  note(db, 'wrapup:new', 'keep', at(MON - 10, 0));
  note(db, 'wrapup:old', 'drop', at(MON, 0) - 70 * 86400_000);
  await runBriefs(db, at(MON, 8), async () => true);
  expect(db.prepare("SELECT id, deleted, text FROM briefs WHERE kind = 'wrapup' ORDER BY id").all()).toEqual([
    { id: 'wrapup:new', deleted: 0, text: 'keep' },
    { id: 'wrapup:old', deleted: 1, text: null },
  ]);
});
