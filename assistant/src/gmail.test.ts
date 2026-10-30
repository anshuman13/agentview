import { describe, expect, test } from 'bun:test';
import { openDb } from './db.js';
import { mailDue, mailId, saveMail, saveWaiting, unanswered } from './gmail.js';
import { acceptAsk } from './slack.js';
import { addWorkdays } from './time.js';

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
const ask = (thread_id: string, urgent = false, url?: string) => ({ thread_id, url, from: 'Kim', title: 'Reply to Kim', quote: 'Can you review this?', urgent });
const item = (db: ReturnType<typeof openDb>, thread: string) => db.prepare('SELECT status, source, source_url, people FROM items WHERE id = ?').get(mailId(thread)) as { status: string; source: string; source_url: string; people: string } | null;

describe('saveMail', () => {
  test('saves new threads for review once, and returns only new urgent ones', () => {
    const db = openDb(':memory:');
    expect(saveMail(db, { asks: [ask('t1', true), ask('t2'), ask('t2'), ask('bad id')], answered: [] }, at(27, 10)).added).toBe(2);
    expect(item(db, 't1')).toEqual({ status: 'suggested', source: 'gmail', source_url: 'https://mail.google.com/mail/u/0/#all/t1', people: 'Kim' });
    expect(item(db, 'bad id')).toBeNull();
    expect(saveMail(db, { asks: [ask('t1', true)], answered: [] }, at(27, 11))).toEqual({ added: 0, urgent: [], said: 0 });
  });

  test('keeps a web link from the tool and drops anything else', () => {
    const db = openDb(':memory:');
    saveMail(db, { asks: [ask('t1', false, 'https://mail.example.test/t1'), ask('t2', false, 'javascript:alert(1)')], answered: [] }, at(27, 10));
    expect(item(db, 't1')!.source_url).toBe('https://mail.example.test/t1');
    expect(item(db, 't2')!.source_url).toBe('https://mail.google.com/mail/u/0/#all/t2');
  });

  test('closes answered threads I have not taken, and leaves accepted ones', () => {
    const db = openDb(':memory:');
    saveMail(db, { asks: [ask('t1'), ask('t2')], answered: [] }, at(27, 10));
    expect(acceptAsk(db, mailId('t2'), 'gmail')).toBe(true);
    saveMail(db, { asks: [], answered: ['t1', 't2', 't3'] }, at(27, 11));
    expect(item(db, 't1')!.status).toBe('done');
    expect(item(db, 't2')!.status).toBe('open');
  });
});

test('reads every half hour on weekday working hours', () => {
  expect(mailDue(0, at(27, 10))).toBe(true);
  expect(mailDue(at(27, 10, 1), at(27, 10, 29))).toBe(false);
  expect(mailDue(at(27, 10, 1), at(27, 10, 30))).toBe(true);
  expect(mailDue(0, at(27, 20))).toBe(false);
  expect(mailDue(0, at(31, 10))).toBe(false);
});

test('saves my promises with their due time', () => {
  const db = openDb(':memory:');
  const r = saveMail(db, { asks: [ask('t1')], answered: [], said: [{ thread_id: 't1', to: 'Kim', title: 'Send Kim the draft', quote: "I'll send it Friday", due: '2026-10-30' }] }, at(27, 10));
  expect(r.said).toBe(1);
  expect(db.prepare('SELECT at, status FROM items WHERE id = ?').get('said:gmail:t1')).toEqual({ at: at(30, 9), status: 'suggested' });
  expect(item(db, 't1')!.status).toBe('suggested');
});

test('lists a sent question after three workdays and drops it on a reply or after 14 days', () => {
  const db = openDb(':memory:');
  const sent = (thread_id: string, sent_at: string) => ({ thread_id, to: 'Ola', subject: 'Budget', sent_at });
  // Thursday 10:00 plus three workdays is Tuesday 10:00.
  expect(saveWaiting(db, [sent('t1', '2026-10-29T10:00'), sent('t2', '2026-10-21T12:00')], [], at(34, 9, 59)).map((w) => w.thread)).toEqual(['t2']);
  expect(saveWaiting(db, [sent('t1', '2026-10-29T10:00')], [], at(34, 10)).map((w) => w.thread)).toEqual(['t2', 't1']);
  expect(saveWaiting(db, [], ['t1'], at(34, 11)).map((w) => w.thread)).toEqual(['t2']);
  expect(saveWaiting(db, [], [], at(35, 13))).toEqual([]);
  expect(unanswered(db)).toEqual([]);
});

test('counts workdays across a weekend', () => {
  expect(addWorkdays(at(30, 15), 3)).toBe(at(35, 15));
  expect(addWorkdays(at(31, 12), 1)).toBe(at(33, 12));
  expect(addWorkdays(at(33, 8), -3)).toBe(at(28, 8));
});
