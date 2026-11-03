import { describe, expect, test } from 'bun:test';
import { ANSWERED, afterScan, autopilotConfig, autopilotState, awayStart, channelAllowed, holdDue, holdNote, marker, modeOf, replyNow, saveAutopilot, sendReply, toPush, underCaps, type AutopilotConfig, type NewAsk } from './autopilot.js';
import { openDb } from './db.js';
import { askId, saveScan } from './slackSave.js';
import { HOUR } from './time.js';

const at = (d: number, h: number) => new Date(2026, 11, d, h).getTime();
const url = (u: string) => (u.startsWith('http') ? u : `https://x.slack.com/archives/C1/${u}`);
const away: AutopilotConfig = { enabled: true, dry_run: false, away: { from: '2026-12-20', to: '2027-01-05', backup: 'Kim' }, escalate: ['Mia'] };
const ask = (u: string, over: Partial<NewAsk> = {}): NewAsk => ({ id: askId(url(u)), url: url(u), from: 'Per', chat: '#ai-help', title: `Answer ${u}`, quote: 'How?', urgent: false, draft: 'Use the guide.', tier: 'answer', confidence: 0.9, ...over });
const posts: string[] = [];
const post = async (url: string, text: string) => {
  posts.push(`${url}: ${text}`);
  return `${url}/reply`;
};
const withAsks = (asks: NewAsk[], now: number) => {
  const db = openDb(':memory:');
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
});

describe('afterScan', () => {
  test('does nothing when off, only records tiers in assist mode', async () => {
    const now = at(10, 10);
    const db = withAsks([ask('u1')], now);
    posts.length = 0;
    expect(await afterScan(db, {}, [], [ask('u1')], now, post)).toEqual({ answered: [], held: [], skipped: [] });
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
    expect(r).toEqual({ answered: [], held: [], skipped: ['Answer u1', 'Answer u2'] });
    expect(db.prepare("SELECT status, why FROM replies WHERE id = ?").get(askId(url('u2')))).toEqual({ status: 'skipped', why: 'someone else answered' });
    expect(db.prepare('SELECT status FROM items WHERE id = ?').get(askId(url('u2')))).toEqual({ status: 'suggested' });
    expect(toPush('assist', {}, ['ai-help'], asks).map((a) => a.title)).toEqual(['Answer u2']);
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
    expect(r).toEqual({ answered: ['Answer u2'], held: [], skipped: ['Answer u1'] });
    expect(db.prepare("SELECT status FROM replies WHERE id = ?").get(askId(url('u1')))).toEqual({ status: 'error' });
  });
});

describe('replyNow', () => {
  test('posts the stored draft as my own reply and closes the ask; nothing without a draft', async () => {
    const now = at(10, 10);
    const db = withAsks([ask('u1'), ask('u2', { draft: undefined })], now);
    posts.length = 0;
    expect(await replyNow(db, { enabled: true, dry_run: false }, askId(url('u1')), now, post)).toEqual({ status: 'sent', url: url('u1') + '/reply' });
    expect(posts).toEqual([url('u1') + ': Use the guide.']);
    expect(db.prepare('SELECT status FROM items WHERE id = ?').get(askId(url('u1')))).toEqual({ status: 'done' });
    expect(await replyNow(db, { enabled: true, dry_run: false }, askId(url('u1')), now, post)).toEqual({ status: 'sent', url: null });
    expect(await replyNow(db, { enabled: true, dry_run: false }, askId(url('u2')), now, post)).toBeNull();
    expect(posts.length).toBe(1);
  });
});

test('settings are cleaned on save and read back from the database', () => {
  const db = openDb(':memory:');
  expect(autopilotConfig(db, '/nonexistent/autopilot.json')).toEqual({});
  const c = saveAutopilot(db, { enabled: 1, away: { from: '2026-12-20', to: 'soon', backup: ' Kim ' }, escalate: 'Mia, , Bo', min_confidence: 2 });
  expect(c).toEqual({ enabled: true, dry_run: true, away: { from: '2026-12-20', to: '', backup: 'Kim', note: '' }, escalate: ['Mia', 'Bo'], dms: true, min_confidence: 0.8 });
  expect(autopilotConfig(db, '/nonexistent/autopilot.json')).toEqual(c);
  expect(modeOf(c, at(22, 10))).toBe('assist');
  expect(autopilotState(db, at(22, 10)).texts).toBeNull();
  saveAutopilot(db, away);
  expect(autopilotState(db, at(22, 10)).texts?.hold).toBe('Hi, this is an auto-reply: Anshuman is away until 5 January and will see this when he is back. Kim covers for him meanwhile.');
});

test('awayStart is midnight of the first away day, only while away', () => {
  const c: AutopilotConfig = { enabled: true, away: { from: '2026-10-26', to: '2026-10-30', backup: '', note: '' } };
  const inside = new Date(2026, 9, 28, 10).getTime();
  expect(awayStart(c, inside)).toBe(new Date(2026, 9, 26).getTime());
  expect(awayStart(c, new Date(2026, 10, 2, 10).getTime())).toBe(0);
  expect(awayStart({ enabled: true }, inside)).toBe(0);
});
