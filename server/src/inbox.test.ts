import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Inbox, SEEN_TTL } from './inbox.js';
import { Replay } from './replay.js';
import { findChat, parseSince } from './route.js';

const dir = mkdtempSync(path.join(os.tmpdir(), 'agentview-inbox-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let n = 0;
const file = () => path.join(dir, `inbox-${n++}.json`);
const item = { chat: 'c1', session: 's1', cwd: '/tmp/project', kind: 'prompt' as const, text: 'hello' };

describe('Inbox', () => {
  it('answers a resend after a server restart as a duplicate', () => {
    const f = file();
    new Inbox(f).accept('m1', item);
    expect(new Inbox(f).has('m1')).toBe(true);
  });

  it('keeps a prompt accepted before a restart until it is handed to Claude', () => {
    const f = file();
    const a = new Inbox(f);
    a.accept('m1', item);
    const b = new Inbox(f);
    expect(b.pending()).toEqual([expect.objectContaining({ cid: 'm1', chat: 'c1', text: 'hello' })]);
    b.done('m1');
    expect(new Inbox(f).pending()).toEqual([]);
    expect(new Inbox(f).has('m1')).toBe(true);
  });

  it('drops the prompts of a chat the user closed', () => {
    const f = file();
    const a = new Inbox(f);
    a.accept('m1', item);
    a.accept('m2', { ...item, chat: 'c2' });
    a.dropChat('c1');
    expect(new Inbox(f).pending().map((i) => i.cid)).toEqual(['m2']);
  });

  it('records nothing when the write fails, so the retry is not taken for a duplicate', () => {
    const a = new Inbox(path.join(dir, 'no-such-dir', '\0bad', 'inbox.json'));
    expect(() => a.accept('m1', item)).toThrow();
    expect(a.has('m1')).toBe(false);
    expect(a.pending()).toEqual([]);
  });

  it('forgets old ids', () => {
    const f = file();
    let now = 0;
    const a = new Inbox(f, () => now);
    a.accept('old');
    now = SEEN_TTL + 1;
    a.accept('new');
    const b = new Inbox(f);
    expect(b.has('old')).toBe(false);
    expect(b.has('new')).toBe(true);
  });

  it('starts empty when the file is missing or broken', () => {
    expect(new Inbox(path.join(dir, 'missing.json')).pending()).toEqual([]);
  });
});

const chat = (id: string, sessionId: string | null) => ({ id, state: { session: { sessionId } } });

describe('findChat', () => {
  const chats = [chat('a', 's-a'), chat('b', 's-b'), chat('new', null)];

  it('reattaches a reconnecting client to its own chat, not the last viewed one', () => {
    expect(findChat(chats, { chat: 'b', session: 's-b' })?.id).toBe('b');
  });

  it('finds a chat reopened under a new id by its session', () => {
    expect(findChat(chats, { chat: 'gone', session: 's-a' })?.id).toBe('a');
  });

  it('finds nothing for an unknown chat instead of another chat', () => {
    expect(findChat(chats, { chat: 'gone', session: 's-gone' })).toBeUndefined();
    expect(findChat(chats, { chat: 'gone', session: null })).toBeUndefined();
    expect(findChat(chats, { chat: '', session: null })).toBeUndefined();
  });
});

describe('Replay', () => {
  const msg = (text: string) => ({ type: 'status' as const, text });

  it('replays only the messages a reconnecting client missed', () => {
    const r = new Replay();
    r.stamp(msg('one'));
    r.stamp(msg('two'));
    r.stamp(msg('three'));
    expect(r.since(r.epoch, 1)?.map((d) => JSON.parse(d).text)).toEqual(['two', 'three']);
    expect(r.since(r.epoch, 3)).toEqual([]);
  });

  it('asks for a full init after a restart, a gap or a bad seq', () => {
    const r = new Replay(2);
    for (const t of ['1', '2', '3', '4']) r.stamp(msg(t));
    expect(r.since('other-epoch', 4)).toBeNull();
    expect(r.since(r.epoch, 1)).toBeNull();
    expect(r.since(r.epoch, 2)?.length).toBe(2);
    expect(r.since(r.epoch, 9)).toBeNull();
  });

  it('parses since from the query string', () => {
    expect(parseSince('abc-1:42')).toEqual({ epoch: 'abc-1', seq: 42 });
    expect(parseSince('nope')).toBeNull();
    expect(parseSince(null)).toBeNull();
  });
});
