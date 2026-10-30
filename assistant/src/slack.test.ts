import { describe, expect, test } from 'bun:test';
import { openDb } from './db.js';
import { scanDue, scanPrompt } from './slack.js';
import { acceptAsk, askId, saveScan } from './slackSave.js';

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
const ask = (url: string, urgent = false) => ({ url, from: 'Kim', chat: '#ai', title: 'Answer Kim', quote: 'Can you check?', urgent });
const item = (db: ReturnType<typeof openDb>, url: string) => db.prepare('SELECT status, source, people FROM items WHERE id = ?').get(askId(url)) as { status: string; source: string; people: string } | null;

describe('scan prompt and counts', () => {
  test('lists recently closed asks and counts messages read', () => {
    const db = openDb(':memory:');
    const r = saveScan(db, { chats: [{ id: 'C1', name: '#ai', kind: 'channel', summary: 'Talk.', new_messages: 4 }, { id: 'C2', name: '#x', kind: 'channel', summary: 'Quiet.', new_messages: 0 }, { id: 'D1', name: 'Kim', kind: 'dm', summary: 'Hi.', new_messages: 2 }], asks: [ask('u1'), ask('u2')], answered: [] }, at(27, 10));
    expect(r.messages).toBe(6);
    saveScan(db, { chats: [], asks: [], answered: ['u1'] }, at(27, 11));
    const prompt = scanPrompt(db, { me: 'U1', domain: 'x.slack.com', channels: [] }, at(27, 9), at(28, 10));
    const [open, closed] = prompt.split('Recently closed asks');
    expect(closed).toContain(`[${askId('u1')}] Answer Kim`);
    expect(open).toContain(`[${askId('u2')}]`);
    expect(open).not.toContain(askId('u1'));
  });
});

describe('saveScan', () => {
  test('saves chats and new asks for review, and returns only new urgent asks', () => {
    const db = openDb(':memory:');
    const { added, urgent } = saveScan(db, { chats: [{ id: 'C1', name: '#ai', kind: 'channel', summary: 'Talk.' }], asks: [ask('u1', true), ask('u2')], answered: [] }, at(27, 10));
    expect(added).toBe(2);
    expect(urgent.map((a) => a.url)).toEqual(['u1']);
    expect(item(db, 'u1')).toEqual({ status: 'suggested', source: 'slack', people: 'Kim · #ai' });
    expect(db.prepare("SELECT summary FROM chats WHERE id = 'C1'").get()).toEqual({ summary: 'Talk.' });
    expect(saveScan(db, { chats: [], asks: [ask('u1', true)], answered: [] }, at(27, 11))).toEqual({ added: 0, urgent: [], said: 0, messages: 0 });
  });

  test('stores only web permalinks', () => {
    const db = openDb(':memory:');
    saveScan(db, { chats: [], asks: [ask('https://x.test/1'), ask('javascript:alert(1)'), ask('https://x.test/2; http, Go, https://y.test')], answered: [] }, at(27, 10));
    const url = (u: string) => (db.prepare('SELECT source_url FROM items WHERE id = ?').get(askId(u)) as { source_url: string | null }).source_url;
    expect(url('https://x.test/1')).toBe('https://x.test/1');
    expect(url('javascript:alert(1)')).toBeNull();
    expect(url('https://x.test/2; http, Go, https://y.test')).toBeNull();
  });

  test('keeps the summary of a chat with no new messages', () => {
    const db = openDb(':memory:');
    saveScan(db, { chats: [{ id: 'C1', name: '#ai', kind: 'channel', summary: 'Talk.', new_messages: 3 }], asks: [], answered: [] }, at(27, 10));
    saveScan(db, { chats: [{ id: 'C1', name: '#ai', kind: 'channel', summary: 'No new messages.', new_messages: 0 }], asks: [], answered: [] }, at(27, 11));
    expect(db.prepare("SELECT summary FROM chats WHERE id = 'C1'").get()).toEqual({ summary: 'Talk.' });
  });

  test('keeps the waiting flag on DMs only', () => {
    const db = openDb(':memory:');
    saveScan(db, { chats: [{ id: 'D1', name: 'Kim', kind: 'dm', summary: 'Asks for the doc.', waiting: true }, { id: 'D2', name: 'Ola', kind: 'dm', summary: 'Thanked me.' }, { id: 'C1', name: '#ai', kind: 'channel', summary: 'Talk.', waiting: true }], asks: [], answered: [] }, at(27, 10));
    expect(db.prepare('SELECT id, waiting FROM chats ORDER BY id').all()).toEqual([{ id: 'C1', waiting: null }, { id: 'D1', waiting: 1 }, { id: 'D2', waiting: 0 }]);
  });

  test('notes a reply once on an accepted ask and keeps it open', () => {
    const db = openDb(':memory:');
    saveScan(db, { chats: [], asks: [ask('u1')], answered: [] }, at(27, 10));
    acceptAsk(db, askId('u1'));
    for (const h of [11, 12]) saveScan(db, { chats: [], asks: [], answered: ['u1'] }, at(27, h));
    const row = db.prepare('SELECT status, text FROM items WHERE id = ?').get(askId('u1')) as { status: string; text: string };
    expect(row.status).toBe('open');
    expect(row.text).toBe('Can you check?\n\nReplied in Slack');
  });

  test('closes answered asks I have not taken, and leaves accepted ones', () => {
    const db = openDb(':memory:');
    saveScan(db, { chats: [], asks: [ask('u1'), ask('u2')], answered: [] }, at(27, 10));
    acceptAsk(db, askId('u2'));
    saveScan(db, { chats: [], asks: [], answered: ['u1', 'u2'] }, at(27, 11));
    expect(item(db, 'u1')!.status).toBe('done');
    expect(item(db, 'u2')!.status).toBe('open');
  });

  test('adds new Slack details to open tasks once, and skips closed ones', () => {
    const db = openDb(':memory:');
    saveScan(db, { chats: [], asks: [ask('u1'), ask('u2')], answered: [] }, at(27, 9));
    saveScan(db, { chats: [], asks: [], answered: ['u2'] }, at(27, 10));
    const detail = (id: string, url: string) => ({ id, note: 'Due Friday.', from: 'Ola', url });
    saveScan(db, { chats: [], asks: [], answered: [], details: [detail(askId('u1'), 'm1'), detail(askId('u1'), 'm1'), detail(askId('u2'), 'm2'), detail('nope', 'm3')] }, at(27, 11));
    saveScan(db, { chats: [], asks: [], answered: [], details: [detail(askId('u1'), 'm1')] }, at(27, 12));
    const text = (url: string) => (db.prepare('SELECT text FROM items WHERE id = ?').get(askId(url)) as { text: string }).text;
    expect(text('u1')).toBe('Can you check?\n\nOla on Slack: Due Friday. m1');
    expect(text('u2')).toBe('Can you check?');
  });
});

test('reads every quarter hour on weekday working hours', () => {
  expect(scanDue(0, at(27, 10))).toBe(true);
  expect(scanDue(at(27, 10, 1), at(27, 10, 14))).toBe(false);
  expect(scanDue(at(27, 10, 1), at(27, 10, 15))).toBe(true);
  expect(scanDue(0, at(27, 20))).toBe(false);
  expect(scanDue(0, at(31, 10))).toBe(false);
});
