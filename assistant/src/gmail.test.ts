import { describe, expect, test } from 'bun:test';
import { openDb } from './db.js';
import { mailDue, mailId, saveMail } from './gmail.js';
import { acceptAsk } from './slack.js';

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
const ask = (thread_id: string, urgent = false, url?: string) => ({ thread_id, url, from: 'Kim', title: 'Reply to Kim', quote: 'Can you review this?', urgent });
const item = (db: ReturnType<typeof openDb>, thread: string) => db.prepare('SELECT status, source, source_url, people FROM items WHERE id = ?').get(mailId(thread)) as { status: string; source: string; source_url: string; people: string } | null;

describe('saveMail', () => {
  test('saves new threads for review once, and returns only new urgent ones', () => {
    const db = openDb(':memory:');
    expect(saveMail(db, { asks: [ask('t1', true), ask('t2'), ask('t2'), ask('bad id')], answered: [] }, at(27, 10)).added).toBe(2);
    expect(item(db, 't1')).toEqual({ status: 'suggested', source: 'gmail', source_url: 'https://mail.google.com/mail/u/0/#all/t1', people: 'Kim' });
    expect(item(db, 'bad id')).toBeNull();
    expect(saveMail(db, { asks: [ask('t1', true)], answered: [] }, at(27, 11))).toEqual({ added: 0, urgent: [] });
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
