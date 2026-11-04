import { describe, expect, test } from 'bun:test';
import { openDb, setMeta } from './db.js';
import { askPush, pushHours, scanDue, scanPrompt, sinceOf } from './slack.js';
import { DAY } from './time.js';
import { acceptAsk, askId, askTags, saveScan, skipAsk } from './slackSave.js';
import { applyChanges } from './sync.js';

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
// Each url gets its own topic, so asks are not taken for repeats of each other.
const topic = (url: string) => `${url.replace(/\W/g, '')}topic`;
const ask = (url: string, urgent = false) => ({ url, from: 'Kim', chat: '#ai', title: `Answer ${topic(url)}`, quote: 'Can you check?', urgent });
const item = (db: ReturnType<typeof openDb>, url: string) => db.prepare('SELECT status, source, people FROM items WHERE id = ?').get(askId(url)) as { status: string; source: string; people: string } | null;

describe('scan prompt and counts', () => {
  test('lists recently closed asks and counts messages read', () => {
    const db = openDb(':memory:');
    const r = saveScan(db, { chats: [{ id: 'C1', name: '#ai', kind: 'channel', summary: 'Talk.', new_messages: 4 }, { id: 'C2', name: '#x', kind: 'channel', summary: 'Quiet.', new_messages: 0 }, { id: 'D1', name: 'Kim', kind: 'dm', summary: 'Hi.', new_messages: 2 }], asks: [ask('u1'), ask('u2')], answered: [] }, at(27, 10));
    expect(r.messages).toBe(6);
    saveScan(db, { chats: [], asks: [], answered: ['u1'] }, at(27, 11));
    const prompt = scanPrompt(db, { me: 'U1', domain: 'x.slack.com', channels: [] }, at(27, 9), at(28, 10));
    const [open, closed] = prompt.split('Recently closed asks');
    expect(closed).toContain(`[${askId('u1')}] Answer u1topic`);
    expect(open).toContain(`[${askId('u2')}]`);
    expect(open).not.toContain(askId('u1'));
  });
});

describe('saveScan', () => {
  test('dismisses suggestions older than a week, source by source', () => {
    const db = openDb(':memory:');
    saveScan(db, { chats: [], asks: [ask('u1')], answered: [] }, at(10, 10));
    saveScan(db, { chats: [], asks: [ask('u2')], answered: [] }, at(15, 10));
    saveScan(db, { chats: [], asks: [], answered: [] }, at(18, 11));
    expect(item(db, 'u1')!.status).toBe('dismissed');
    expect(item(db, 'u2')!.status).toBe('suggested');
  });

  test('saves chats and new asks for review, and returns only new urgent asks', () => {
    const db = openDb(':memory:');
    const { added, urgent } = saveScan(db, { chats: [{ id: 'C1', name: '#ai', kind: 'channel', summary: 'Talk.' }], asks: [ask('u1', true), ask('u2')], answered: [] }, at(27, 10));
    expect(added).toBe(2);
    expect(urgent.map((a) => a.url)).toEqual(['u1']);
    expect(item(db, 'u1')).toEqual({ status: 'suggested', source: 'slack', people: 'Kim · #ai' });
    expect(db.prepare("SELECT summary FROM chats WHERE id = 'C1'").get()).toEqual({ summary: 'Talk.' });
    expect(saveScan(db, { chats: [], asks: [ask('u1', true)], answered: [] }, at(27, 11))).toEqual({ chats: 0, added: 0, urgent: [], said: 0, messages: 0, newAsks: [] });
  });

  test('skips repeats of a dismissed ask from another message, and asks in a DM I answered last', () => {
    const db = openDb(':memory:');
    const dm = (url: string, title: string) => ({ url, from: 'Kim', chat: 'DM', title, quote: 'Can you?', urgent: false });
    saveScan(db, { chats: [], asks: [dm('u1', 'Give input on interview prep')], answered: [] }, at(27, 10));
    db.prepare("UPDATE items SET status = 'dismissed' WHERE id = ?").run(askId('u1'));
    expect(saveScan(db, { chats: [], asks: [dm('u2', 'Provide input on the interview prep'), dm('u3', 'Book the offsite venue')], answered: [] }, at(27, 11)).added).toBe(1);
    const chat = { id: 'D1', name: 'Kim', kind: 'dm' as const, summary: 'I answered.', waiting: false };
    expect(saveScan(db, { chats: [chat], asks: [dm('u4', 'Review the budget')], answered: [] }, at(27, 12)).added).toBe(0);
  });

  test('skips an ask answered in the same scan', () => {
    const db = openDb(':memory:');
    expect(saveScan(db, { chats: [], asks: [ask('u1'), ask('u2')], answered: ['u1'] }, at(27, 10)).added).toBe(1);
    expect(item(db, 'u1')).toBeNull();
  });

  test('a reply in a DM closes that person\'s suggested DM asks, not channel asks', () => {
    const db = openDb(':memory:');
    saveScan(db, { chats: [], asks: [{ ...ask('u1'), chat: 'DM', title: 'Review the doc' }, ask('u2')], answered: [] }, at(27, 10));
    saveScan(db, { chats: [{ id: 'D1', name: 'kim', kind: 'dm', summary: 'I answered.', waiting: false }], asks: [], answered: [] }, at(27, 11));
    expect(item(db, 'u1')!.status).toBe('done');
    expect(item(db, 'u2')!.status).toBe('suggested');
  });

  test('keeps different short asks apart, and an ask apart from my promise on it', () => {
    const db = openDb(':memory:');
    const dm = (url: string, title: string) => ({ url, from: 'Kim', chat: 'DM', title, quote: 'Can you?', urgent: false });
    const r = saveScan(db, { chats: [], asks: [dm('u1', 'Review the doc'), dm('u2', 'Review the budget'), dm('u3', 'Send Kim the report')], said: [{ url: 'u4', to: 'Kim', chat: 'DM', title: 'Send the report', quote: 'Will do' }], answered: [] }, at(27, 10));
    expect([r.added, r.said]).toEqual([3, 1]);
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

  test('fulfilled closes the matching promise and leaves another open', () => {
    const db = openDb(':memory:');
    const said = (url: string) => ({ url, to: 'Kim', chat: '#ai', title: `Send ${topic(url)}`, quote: 'I will send it' });
    saveScan(db, { chats: [], asks: [], answered: [], said: [said('https://x.test/1'), said('https://x.test/2')] }, at(27, 10));
    expect(scanPrompt(db, { me: 'U1', domain: 'x.slack.com', channels: [] } as any, at(27, 9), at(27, 10))).toContain('Open promises:\n- [said:');
    saveScan(db, { chats: [], asks: [], answered: [], fulfilled: ['https://x.test/1'] }, at(27, 11));
    const st = (u: string) => (db.prepare('SELECT status FROM items WHERE id = ?').get(`said:${askId(u)}`) as { status: string }).status;
    expect([st('https://x.test/1'), st('https://x.test/2')]).toEqual(['done', 'suggested']);
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

test('away mode reads every day until 22:00 and pushes on weekends', () => {
  expect(scanDue(0, at(31, 10), true)).toBe(true);
  expect(scanDue(0, at(27, 21), true)).toBe(true);
  expect(scanDue(0, at(27, 22), true)).toBe(false);
  expect(pushHours({}, at(31, 10))).toBe(false);
  expect(pushHours({}, at(31, 10), true)).toBe(true);
  expect(pushHours({}, at(31, 18), true)).toBe(false);
});

describe('sinceOf', () => {
  test('slack:last 4 days back gives a 4 day window, capped at 7', () => {
    const db = openDb(':memory:');
    const now = at(28, 10);
    setMeta(db, 'slack:last', String(now - 4 * DAY));
    expect(now - sinceOf(db, now)).toBe(4 * DAY);
    setMeta(db, 'slack:last', String(now - 20 * DAY));
    expect(now - sinceOf(db, now)).toBe(7 * DAY);
  });

  test('never reaches before the away start', () => {
    const db = openDb(':memory:');
    const now = at(28, 10);
    setMeta(db, 'slack:last', String(now - 4 * DAY));
    expect(sinceOf(db, now, now - DAY)).toBe(now - DAY);
    expect(sinceOf(db, now, 0)).toBe(now - 4 * DAY);
  });
});

describe('askPush', () => {
  const base = { id: 'a1', url: 'https://x.slack.com/archives/C1/p1', from: 'Kim', chat: '#ai', title: 'Answer Kim', quote: 'Can you check?', urgent: false, draft: 'Yes, see the guide.' };
  test('a draft in assist mode gets Send reply; a hold gets a Needs you title and no Send', () => {
    const p = askPush(base, 'assist');
    expect(p.title).toBe('Kim: Answer Kim');
    expect(p.actions).toContain('Send reply');
    expect(p.body).toContain('Reply: Yes, see the guide.');
    expect(p.actions).toContain('Skip, ');
    expect(p.actions).not.toContain('Make task');
    expect(p.actions.split(';').length).toBe(3);
    expect(askPush(base, 'assist', 'From Support FAQ: The guide covers it.').body).toContain('Reply: Yes, see the guide.\nFrom Support FAQ: The guide covers it.');
    expect(askPush({ ...base, tier: 'answer', confidence: 0.9 }, 'assist', 'From Support FAQ: The guide covers it.').body).toContain('\nFAQ answer, 90% sure. From Support FAQ: The guide covers it.');
    const h = askPush({ ...base, tier: 'hold', draft: 'I will look at it today.' }, 'assist');
    expect(h.title).toBe('Needs you, Kim: Answer Kim');
    expect(h.actions).not.toContain('Send reply');
    expect(h.actions).toContain('Make task');
    expect(h.actions).toContain('Skip');
    expect(h.body).toContain('Needs you: I will look at it today.');
    expect(askPush(base, 'away').actions).not.toContain('Send reply');
    const e = askPush({ ...base, tier: 'hold', draft: '' }, 'assist');
    expect(e.title).toBe('Needs you, Kim: Answer Kim');
    expect(e.body).toBe('Can you check?');
    expect(e.actions).toContain('Make task');
    expect(e.actions).not.toContain('Send reply');
  });

  test('askTags marks a sure answer on a live claim as faq and a hold as needs-you', () => {
    const db = openDb(':memory:');
    applyChanges(db, [
      { table: 'pages', id: 'p1', profile: 'work', updated_at: 1, fields: { title: 'Support FAQ', state: 'live' } },
      { table: 'facts', id: 'f1', profile: 'work', updated_at: 1, fields: { page_id: 'p1', text: 'The guide covers it.' } },
    ]);
    expect(askTags(db, { tier: 'answer', confidence: 0.9, claims: ['f1'] })).toBe('faq');
    expect(askTags(db, { tier: 'answer', confidence: 0.6, claims: ['f1'] })).toBeNull();
    expect(askTags(db, { tier: 'answer', confidence: 0.9, claims: ['gone'] })).toBeNull();
    expect(askTags(db, { tier: 'hold', confidence: 0.9, claims: ['f1'] })).toBe('needs-you');
  });

  test('skipAsk closes the ask, drops its draft and marks the reply skipped', () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO items (id, profile, version, updated_at, title, source, status, draft) VALUES ('a1', 'work', 1, 0, 'Answer Kim', 'slack', 'suggested', 'Yes.')").run();
    db.prepare("INSERT INTO replies (profile, id, status, at) VALUES ('work', 'a1', 'held', 0)").run();
    expect(skipAsk(db, 'a1', 'too long', 5)).toBe(true);
    expect(db.prepare('SELECT status, draft FROM items WHERE id = ?').get('a1')).toEqual({ status: 'done', draft: null });
    expect(db.prepare('SELECT status, why, draft_text, skip_reason FROM replies WHERE id = ?').get('a1')).toEqual({ status: 'skipped', why: 'skipped', draft_text: 'Yes.', skip_reason: 'too long' });
    expect(skipAsk(db, 'nope')).toBe(false);
  });
});
