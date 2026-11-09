import { describe, expect, test } from 'bun:test';
import { ANSWERED, CHANGED, afterScan, awayDigest, dayDigest, escalated, scanModel, autopilotConfig, autopilotState, awayStart, channelAllowed, holdDue, holdNote, replyHistory, marker, modeOf, replyNow, saveAutopilot, sendReply, toPush, underCaps, type AutopilotConfig, type NewAsk } from './autopilot.js';
import { openDb } from '../core/db.js';
import { applyChanges } from '../core/sync.js';
import { askId, saveScan, threadKey } from './slackSave.js';
import { HOUR } from '../core/time.js';

const at = (d: number, h: number) => new Date(2026, 11, d, h).getTime();
const url = (u: string) => (u.startsWith('http') ? u : `https://x.slack.com/archives/C1/${u}`);
const away: AutopilotConfig = { enabled: true, auto_send: true, dry_run: false, away: { from: '2026-12-20', to: '2027-01-05', backup: 'Kim' }, escalate: ['Mia'] };
const ask = (u: string, over: Partial<NewAsk> = {}): NewAsk => ({ id: askId(url(u)), url: url(u), from: 'Per', chat: '#ai-help', title: `Answer ${u}`, quote: 'How?', urgent: false, draft: 'Use the guide.', tier: 'answer', confidence: 0.9, claims: ['f1'], ...over });
const posts: string[] = [];
const post = async (url: string, text: string) => {
  posts.push(`${url}: ${text}`);
  return `${url}/reply`;
};
const withAsks = (asks: NewAsk[], now: number) => {
  const db = openDb(':memory:');
  applyChanges(db, [
    { table: 'pages', id: 'p1', profile: 'work', updated_at: now, fields: { title: 'Guide', state: 'live' } },
    { table: 'facts', id: 'f1', profile: 'work', updated_at: now, fields: { page_id: 'p1', text: 'The guide covers it.' } },
  ]);
  saveScan(db, { chats: [], asks, answered: [] }, now);
  return db;
};

describe('modeOf', () => {
  test('off until enabled, assist outside the away window, away inside it', () => {
    expect(modeOf({}, at(22, 10))).toBe('off');
    expect(modeOf({ enabled: true }, at(22, 10))).toBe('assist');
    expect(modeOf(away, at(22, 10))).toBe('away');
    expect(modeOf(away, at(10, 10))).toBe('assist');
    expect(modeOf({ ...away, enabled: false }, at(22, 10))).toBe('off');
    expect(modeOf({ ...away, auto_send: false }, at(22, 10))).toBe('assist');
  });

  test('texts name the return date and the backup', () => {
    expect(marker(away.away!)).toBe("(auto-reply from Anshuman's assistant: he is away until 5 January, Kim covers meanwhile)");
    expect(holdNote({ from: '2026-12-20', to: '2027-01-05' })).toBe('Hi, this is an auto-reply: Anshuman is away until 5 January and will see this when he is back.');
  });
});

test('DMs and watched channels are allowed, temp channels and others are not', () => {
  const watched = ['ai-help', 'tmp-rollout', 'temp-x'];
  expect(channelAllowed({}, watched, 'DM')).toBe(true);
  expect(channelAllowed({ dms: false }, watched, 'DM')).toBe(false);
  expect(channelAllowed({}, watched, '#ai-help')).toBe(true);
  expect(channelAllowed({}, watched, '#tmp-rollout')).toBe(false);
  expect(channelAllowed({}, watched, '#random')).toBe(false);
  expect(channelAllowed({ channels: ['random'] }, watched, '#random')).toBe(true);
});

test('urgent asks are always pushed; away mode also pushes escalations, assist mode every covered draft', () => {
  const asks = [ask('u1'), ask('u2', { urgent: true, draft: undefined }), ask('u3', { tier: 'escalate' }), ask('u4', { from: 'Mia Berg' }), ask('u5', { chat: '#tmp-x' })];
  const names = (xs: NewAsk[]) => xs.map((a) => a.title);
  expect(names(toPush('off', away, ['ai-help'], asks))).toEqual(['Answer u2']);
  expect(names(toPush('away', away, ['ai-help'], asks))).toEqual(['Answer u2', 'Answer u3', 'Answer u4']);
  expect(names(toPush('assist', away, ['ai-help'], asks))).toEqual(['Answer u1', 'Answer u2', 'Answer u3', 'Answer u4']);
  expect(names(toPush('assist', away, ['ai-help'], [ask('e1', { tier: 'hold', draft: '' }), ask('e2', { draft: '' })]))).toEqual(['Answer e1']);
});

describe('afterScan', () => {
  test('does nothing when off, only records tiers in assist mode', async () => {
    const now = at(10, 10);
    const db = withAsks([ask('u1')], now);
    posts.length = 0;
    expect(await afterScan(db, {}, [], [ask('u1')], now, post)).toEqual({ answered: [], held: [], skipped: [], followups: [] });
    expect(db.prepare('SELECT COUNT(*) AS n FROM replies').get()).toEqual({ n: 0 });
    await afterScan(db, { enabled: true }, [], [ask('u1')], now, post);
    expect(db.prepare('SELECT status, tier, mode FROM replies').get()).toEqual({ status: 'held', tier: 'answer', mode: 'assist' });
    expect(posts).toEqual([]);
  });

  test('away: answers sure tier A asks with the marker, holds the rest once per person, skips escalated people and other channels', async () => {
    const now = at(22, 10);
    const asks = [ask('u1'), ask('u2', { from: 'Ann', tier: 'hold' }), ask('u3', { from: 'Ann', tier: 'hold' }), ask('u4', { from: 'Mia Berg' }), ask('u5', { chat: '#random' }), ask('u6', { confidence: 0.5 })];
    const db = withAsks(asks, now);
    posts.length = 0;
    const r = await afterScan(db, away, ['ai-help'], asks, now, post);
    expect(r.answered).toEqual(['Answer u1']);
    expect(r.held).toEqual(['Answer u2', 'Answer u6']);
    expect(r.skipped).toEqual(['Answer u3', 'Answer u4', 'Answer u5']);
    expect(posts[0]).toBe(url('u1') + ": (auto-reply from Anshuman's assistant: he is away until 5 January, Kim covers meanwhile) Use the guide.");
    expect(posts[1]).toContain(url('u2') + ': Hi, this is an auto-reply');
    const item = (u: string) => db.prepare('SELECT status, text FROM items WHERE id = ?').get(askId(url(u))) as { status: string; text: string };
    expect(item('u1').status).toBe('done');
    expect(item('u1').text).toContain(`Autopilot replied ${url('u1')}/reply: `);
    expect(item('u2').status).toBe('suggested');
    expect(db.prepare("SELECT status, url FROM replies WHERE id = ?").get(askId(url('u1')))).toEqual({ status: 'sent', url: url('u1') + '/reply' });
    expect(db.prepare("SELECT status FROM replies WHERE id = ?").get(askId(url('u4')))).toEqual({ status: 'held' });
    expect(holdDue(db, 'ann', now + HOUR)).toBe(false);
    expect(holdDue(db, 'ann', now + 4 * 24 * HOUR)).toBe(true);
  });

  test('skips an ask someone else answered, before and at posting time', async () => {
    const now = at(22, 10);
    const asks = [ask('u1', { answered_by_other: true }), ask('u2')];
    const db = withAsks(asks, now);
    const r = await afterScan(db, away, ['ai-help'], asks, now, async () => ANSWERED);
    expect(r).toEqual({ answered: [], held: [], skipped: ['Answer u1', 'Answer u2'], followups: [] });
    expect(db.prepare("SELECT status, why FROM replies WHERE id = ?").get(askId(url('u2')))).toEqual({ status: 'skipped', why: 'someone else answered' });
    expect(db.prepare('SELECT status FROM items WHERE id = ?').get(askId(url('u2')))).toEqual({ status: 'suggested' });
    expect(toPush('assist', {}, ['ai-help'], asks).map((a) => a.title)).toEqual(['Answer u2']);
  });

  test('keeps the ask open with a note when the thread changed since the draft', async () => {
    const now = at(22, 10);
    const asks = [ask('u1')];
    const db = withAsks(asks, now);
    const r = await afterScan(db, away, ['ai-help'], asks, now, async () => CHANGED);
    expect(r).toEqual({ answered: [], held: [], skipped: ['Answer u1'], followups: [] });
    expect(db.prepare('SELECT status, why FROM replies WHERE id = ?').get(askId(url('u1')))).toEqual({ status: 'held', why: 'thread changed since draft' });
    expect(db.prepare('SELECT status FROM items WHERE id = ?').get(askId(url('u1')))).toEqual({ status: 'suggested' });
  });

  test('a tier answer with no live claim becomes a hold, and a second ask in an answered thread only pushes me', async () => {
    const now = at(22, 10);
    const asks = [ask('u1', { claims: ['gone'] }), ask('u2')];
    const db = withAsks(asks, now);
    posts.length = 0;
    const r = await afterScan(db, away, ['ai-help'], asks, now, post);
    expect(r).toEqual({ answered: ['Answer u2'], held: ['Answer u1'], skipped: [], followups: [] });
    expect(db.prepare("SELECT tier, claims FROM replies WHERE id = ?").get(askId(url('u2')))).toEqual({ tier: 'answer', claims: '["f1"]' });
    const follow = ask('u3', { url: `${url('u2')}?thread_ts=u2&cid=C1` });
    saveScan(db, { chats: [], asks: [follow], answered: [] }, now + HOUR);
    const r2 = await afterScan(db, away, ['ai-help'], [follow], now + HOUR, post);
    expect(r2.skipped).toEqual(['Answer u3']);
    expect(r2.followups).toEqual([follow.id]);
    expect(toPush('away', away, ['ai-help'], [follow], r2.followups).map((a) => a.id)).toEqual([follow.id]);
    expect(posts.length).toBe(2);
    expect(threadKey('https://x.slack.com/archives/C9/p1700000000123456')).toBe('C9/1700000000.123456');
  });

  test('external asks escalate, and a second ask within 3 days of a holding note is pushed instead of silently skipped', async () => {
    const now = at(22, 10);
    const asks = [ask('u1', { external: true }), ask('u2', { from: 'Ann', tier: 'hold' }), ask('u3', { from: 'Ann', tier: 'hold' })];
    const db = withAsks(asks, now);
    posts.length = 0;
    const r = await afterScan(db, away, ['ai-help'], asks, now, post);
    expect(r).toEqual({ answered: [], held: ['Answer u2'], skipped: ['Answer u1', 'Answer u3'], followups: [askId(url('u3'))] });
    expect(db.prepare("SELECT status, why FROM replies WHERE id = ?").get(askId(url('u3')))).toEqual({ status: 'skipped', why: 'second ask within 3 days of a holding note' });
    expect(toPush('away', away, ['ai-help'], asks, r.followups).map((a) => a.title)).toEqual(['Answer u1', 'Answer u3']);
  });

  test('a dry run logs instead of sending and leaves the task open', async () => {
    const now = at(22, 10);
    const db = withAsks([ask('u1')], now);
    posts.length = 0;
    await afterScan(db, { ...away, dry_run: true }, ['ai-help'], [ask('u1')], now, post);
    expect(posts).toEqual([]);
    expect(db.prepare('SELECT status FROM replies').get()).toEqual({ status: 'dry' });
    expect(db.prepare('SELECT status, text FROM items').get()).toEqual({ status: 'suggested', text: "How?\n\nAutopilot would reply: (auto-reply from Anshuman's assistant: he is away until 5 January, Kim covers meanwhile) Use the guide." });
  });

  test('never replies twice to the same ask, and stops at the hourly cap', async () => {
    const now = at(22, 10);
    const db = withAsks([ask('u1')], now);
    posts.length = 0;
    await afterScan(db, away, ['ai-help'], [ask('u1')], now, post);
    await afterScan(db, away, ['ai-help'], [ask('u1')], now + 1, post);
    expect(posts.length).toBe(1);
    for (let i = 0; i < 9; i++) await sendReply(db, away, { id: `x${i}`, url: `x${i}`, from: 'P', chat: 'DM' }, 'answer', 'hi', now + i, post);
    expect(underCaps(db, now + 20)).toBe(false);
    const r = await afterScan(db, away, ['ai-help'], [ask('u9')], now + 20, post);
    expect(r.skipped).toEqual(['Answer u9']);
  });

  test('a failed post marks the reply as an error and keeps going', async () => {
    const now = at(22, 10);
    const asks = [ask('u1'), ask('u2')];
    const db = withAsks(asks, now);
    let n = 0;
    const flaky = async (url: string, text: string) => {
      if (n++ === 0) throw new Error('Slack down');
      return post(url, text);
    };
    const r = await afterScan(db, away, ['ai-help'], asks, now, flaky);
    expect(r).toEqual({ answered: ['Answer u2'], held: [], skipped: ['Answer u1'], followups: [] });
    expect(db.prepare("SELECT status, tries FROM replies WHERE id = ?").get(askId(url('u1')))).toEqual({ status: 'error', tries: 1 });
  });

  test('retries a failed post on the next scans, then pushes me once after the third failure', async () => {
    const now = at(22, 10);
    const asks = [ask('u1')];
    const db = withAsks(asks, now);
    const down = async () => { throw new Error('Slack down'); };
    const pushes: string[] = [];
    const push = async (title: string) => { pushes.push(title); return true; };
    await afterScan(db, away, ['ai-help'], asks, now, down, push);
    const r2 = await afterScan(db, away, ['ai-help'], [], now + HOUR, down, push);
    expect(r2.answered).toEqual([]);
    expect(db.prepare("SELECT tries FROM replies WHERE id = ?").get(askId(url('u1')))).toEqual({ tries: 2 });
    await afterScan(db, away, ['ai-help'], [], now + 2 * HOUR, down, push);
    expect(pushes).toEqual([]);
    await afterScan(db, away, ['ai-help'], [], now + 3 * HOUR, down, push);
    expect(pushes).toEqual(['Reply failed 3 times']);
    await afterScan(db, away, ['ai-help'], [], now + 4 * HOUR, down, push);
    expect(pushes.length).toBe(1);
    posts.length = 0;
    const db2 = withAsks(asks, now);
    await afterScan(db2, away, ['ai-help'], asks, now, down, push);
    const r = await afterScan(db2, away, ['ai-help'], [], now + HOUR, post, push);
    expect(r.answered).toEqual(['Answer u1']);
    expect(db2.prepare("SELECT status FROM replies WHERE id = ?").get(askId(url('u1')))).toEqual({ status: 'sent' });
  });
});

describe('replyNow', () => {
  test('posts the stored draft as my own reply and closes the ask; nothing without a draft', async () => {
    const now = at(10, 10);
    const db = withAsks([ask('u1', { tier: 'hold', draft: 'Will look at it.' }), ask('u2', { draft: undefined })], now);
    posts.length = 0;
    expect(await replyNow(db, { enabled: true, dry_run: false }, askId(url('u1')), now, post)).toEqual({ status: 'sent', url: url('u1') + '/reply' });
    expect(posts).toEqual([url('u1') + ': Will look at it.']);
    expect(db.prepare('SELECT tier FROM replies WHERE id = ?').get(askId(url('u1')))).toEqual({ tier: 'hold' });
    expect(db.prepare('SELECT status FROM items WHERE id = ?').get(askId(url('u1')))).toEqual({ status: 'done' });
    expect(await replyNow(db, { enabled: true, dry_run: false }, askId(url('u1')), now, post)).toEqual({ status: 'sent', url: null });
    expect(await replyNow(db, { enabled: true, dry_run: false }, askId(url('u2')), now, post)).toBeNull();
    expect(posts.length).toBe(1);
  });
  test('posts in a dry run too, uses the text sent with the press, and closes an ask someone else answered', async () => {
    const now = at(10, 10);
    const db = withAsks([ask('u1'), ask('u2')], now);
    posts.length = 0;
    expect(await replyNow(db, { enabled: true, dry_run: true }, askId(url('u1')), now, post, true, 'Edited on the phone.')).toEqual({ status: 'sent', url: url('u1') + '/reply' });
    expect(posts).toEqual([url('u1') + ': Edited on the phone.']);
    expect(db.prepare('SELECT status, draft FROM items WHERE id = ?').get(askId(url('u1')))).toEqual({ status: 'done', draft: 'Edited on the phone.' });
    expect(db.prepare('SELECT edited, draft_text FROM replies WHERE id = ?').get(askId(url('u1')))).toEqual({ edited: 1, draft_text: 'Use the guide.' });
    expect(await replyNow(db, { enabled: true, dry_run: false }, askId(url('u2')), now, async () => ANSWERED)).toEqual({ status: 'answered', url: null });
    expect(db.prepare('SELECT status FROM items WHERE id = ?').get(askId(url('u2')))).toEqual({ status: 'done' });
  });
});

test('settings are cleaned on save and read back from the database', () => {
  const db = openDb(':memory:');
  expect(autopilotConfig(db, '/nonexistent/autopilot.json')).toEqual({});
  const c = saveAutopilot(db, { enabled: 1, away: { from: '2026-12-20', to: 'soon', backup: ' Kim ' }, escalate: 'Mia, , Bo', min_confidence: 2 });
  expect(c).toEqual({ enabled: true, auto_send: false, dry_run: true, away: { from: '2026-12-20', to: '', backup: 'Kim', note: '' }, escalate: ['Mia', 'Bo'], manager: '', model: 'sonnet', dms: true, min_confidence: 0.8 });
  expect(autopilotConfig(db, '/nonexistent/autopilot.json')).toEqual(c);
  expect(modeOf(c, at(22, 10))).toBe('assist');
  expect(autopilotState(db, at(22, 10)).texts).toBeNull();
  saveAutopilot(db, away);
  expect(autopilotState(db, at(22, 10)).texts?.hold).toBe('Hi, this is an auto-reply: Anshuman is away until 5 January and will see this when he is back. Kim covers for him meanwhile.');
});

test('awayStart is midnight of the first away day, only while away', () => {
  const c: AutopilotConfig = { enabled: true, auto_send: true, away: { from: '2026-10-26', to: '2026-10-30', backup: '', note: '' } };
  const inside = new Date(2026, 9, 28, 10).getTime();
  expect(awayStart(c, inside)).toBe(new Date(2026, 9, 26).getTime());
  expect(awayStart(c, new Date(2026, 10, 2, 10).getTime())).toBe(0);
  expect(awayStart({ enabled: true }, inside)).toBe(0);
});

test('escalated matches whole names or exact user ids, and always the manager', () => {
  const c: AutopilotConfig = { escalate: ['Mia', 'U0ABC1234'], manager: 'Bo Li' };
  expect(escalated(c, 'Mia Berg')).toBe(true);
  expect(escalated(c, 'Jeremia Holm')).toBe(false);
  expect(escalated(c, 'Someone', 'U0ABC1234')).toBe(true);
  expect(escalated(c, 'U0ABC1234 fan')).toBe(false);
  expect(escalated(c, 'bo li')).toBe(true);
  expect(escalated({}, 'Mia')).toBe(false);
});

test('awayDigest writes one brief per away day from 17:00 with what was done, and pushes the counts once', async () => {
  const now = at(22, 10);
  const asks = [ask('u1'), ask('u2', { from: 'Ann', tier: 'hold' }), ask('u3', { from: 'Mia Berg' })];
  const db = withAsks(asks, now);
  await afterScan(db, away, ['ai-help'], asks, now, post);
  const pushes: string[] = [];
  const push = async (title: string, _s: string, body: string) => { pushes.push(`${title}: ${body}`); return true; };
  expect(await awayDigest(db, away, at(22, 16), push)).toBeNull();
  const text = await awayDigest(db, away, at(22, 17), push);
  expect(text).toBe('Away day 2026-12-22');
  const brief = db.prepare("SELECT rows FROM briefs WHERE id = 'away:2026-12-22'").get() as { rows: string };
  const rows = JSON.parse(brief.rows) as { id: string; who: string; chat: string; outcome: string; reason: string; url: string }[];
  expect(rows.map((r) => r.outcome)).toEqual(['answered', 'held', 'escalated']);
  expect(rows[2]).toMatchObject({ who: 'Mia Berg', chat: '#ai-help' });
  expect(pushes).toEqual(['Away digest: 1 answered, 1 held with a note, 1 escalated to you, 0 skipped or failed']);
  expect(await awayDigest(db, away, at(22, 18), push)).toBeNull();
  expect(db.prepare("SELECT kind FROM briefs WHERE id = 'away:2026-12-22'").get()).toEqual({ kind: 'away' });
});

test('a Send that failed in assist mode is posted again on the next scan', async () => {
  const now = new Date(2026, 10, 4, 10).getTime();
  const asks = [ask('r1')];
  const db = withAsks(asks, now);
  const assist: AutopilotConfig = { enabled: true };
  await afterScan(db, assist, ['ai-help'], asks, now, post);
  await expect(replyNow(db, assist, asks[0].id, now + 1, async () => { throw new Error('no connector'); })).rejects.toThrow('no connector');
  expect(db.prepare("SELECT status FROM items WHERE id = ?").get(asks[0].id)).toEqual({ status: 'suggested' });
  const before = posts.length;
  const out = await afterScan(db, assist, ['ai-help'], [], now + 2, post);
  expect(out.answered).toEqual(['Answer r1']);
  expect(posts.length).toBe(before + 1);
  expect(db.prepare("SELECT status FROM replies WHERE id = ?").get(asks[0].id)).toEqual({ status: 'sent' });
  expect(db.prepare("SELECT status FROM items WHERE id = ?").get(asks[0].id)).toEqual({ status: 'done' });
});

test('dayDigest writes one brief per weekday in assist mode from 17:00 with sent, failed, skipped and waiting asks', async () => {
  const now = new Date(2026, 10, 4, 10).getTime();
  const h = (hour: number) => new Date(2026, 10, 4, hour).getTime();
  const asks = [ask('d1'), ask('d2', { from: 'Ann' }), ask('d3', { from: 'Bo' }), ask('d4', { from: 'Cy' })];
  const db = withAsks(asks, now);
  const assist: AutopilotConfig = { enabled: true, dry_run: false };
  await afterScan(db, assist, ['ai-help'], asks, now, post);
  await replyNow(db, assist, asks[0].id, h(11), post, true);
  await replyNow(db, assist, asks[1].id, h(12), async () => { throw new Error('no connector'); }).catch(() => null);
  applyChanges(db, [{ table: 'items', id: asks[2].id, profile: 'work', updated_at: h(13), fields: { status: 'done' } }]);
  const pushes: string[] = [];
  const push = async (title: string, _s: string, body: string) => { pushes.push(`${title}: ${body}`); return true; };
  expect(await dayDigest(db, assist, h(16), push)).toBeNull();
  const text = await dayDigest(db, assist, h(17), push);
  expect(text).toBe('Today in Slack');
  const brief = db.prepare("SELECT rows FROM briefs WHERE id = 'day:2026-11-04'").get() as { rows: string };
  const rows = JSON.parse(brief.rows) as { who: string; outcome: string; reason: string; edited: boolean }[];
  expect(rows.map((r) => [r.who, r.outcome, r.edited])).toEqual([['Per', 'sent', true], ['Ann', 'failed', false], ['Bo', 'skipped', false], ['Cy', 'waiting', false]]);
  expect(rows.every((r) => r.reason.split(' ').length <= 6)).toBe(true);
  expect(rows[1].reason).toBe('Error: no connector');
  expect(rows[0].reason).toBe('');
  expect(pushes).toEqual(['Today: 1 sent (1 edited), 1 failed, 1 skipped, 1 waiting for you']);
  expect(await dayDigest(db, assist, h(18), push)).toBeNull();
  expect(await dayDigest(withAsks([], now), assist, h(17), push)).toBeNull();
  expect(db.prepare("SELECT kind FROM briefs WHERE id = 'day:2026-11-04'").get()).toEqual({ kind: 'day' });
});

test('scanModel uses Opus only when chosen and away', () => {
  expect(scanModel({ ...away, model: 'opus' }, at(22, 10))).toBe('opus');
  expect(scanModel({ ...away, model: 'opus' }, new Date(2026, 10, 2, 10).getTime())).toBe('sonnet');
  expect(scanModel(away, at(22, 10))).toBe('sonnet');
});

describe('replyHistory', () => {
  const put = (db: ReturnType<typeof openDb>, id: string, over: { who?: string; status?: string; text?: string; sent?: number }) =>
    db.prepare('INSERT INTO replies (profile, id, who, status, text, at, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('work', id, over.who ?? 'Per', over.status ?? 'sent', over.text ?? 'ok', 1, over.sent ?? 1);

  test('keeps the last 3 sent or dry replies to the person, newest first, cut to the first line', () => {
    const db = openDb(':memory:');
    put(db, 'a', { sent: 10, text: 'one' });
    put(db, 'b', { sent: 20, status: 'dry', text: 'two' });
    put(db, 'c', { sent: 30, who: 'per', text: `first\nsecond` });
    put(db, 'd', { sent: 40, text: 'x'.repeat(200) });
    put(db, 'e', { sent: 50, status: 'draft', text: 'unsent' });
    put(db, 'f', { sent: 60, who: 'Other', text: 'other' });
    const r = replyHistory(db, 'PER');
    expect(r.map((x) => x.at)).toEqual([40, 30, 20]);
    expect(r[0]!.line).toBe(`${'x'.repeat(119)}…`);
    expect(r[1]!.line).toBe('first');
  });

});
