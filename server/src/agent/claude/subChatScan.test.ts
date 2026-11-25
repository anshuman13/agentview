import { describe, expect, it } from 'bun:test';
import { linkOlder } from '../../../../shared/subChats.js';
import { headInfo, matchSent, maybeParents, scanInput, sentClears } from './subChatScan.js';

const line = (e: object) => JSON.stringify(e);
const owner = line({ type: 'session-owner', accountUuid: 'acc-1', sessionId: 's' });
const caveat = line({ type: 'user', isMeta: true, message: { role: 'user', content: '<local-command-caveat>x</local-command-caveat>' }, timestamp: '2026-11-25T18:00:00.000Z' });
const clear = line({ type: 'user', message: { role: 'user', content: '<command-name>/clear</command-name>\n<command-message>clear</command-message>' }, timestamp: '2026-11-25T18:00:05.041Z', gitBranch: 'main' });
const prompt = line({ type: 'user', message: { role: 'user', content: 'Fix the list' }, timestamp: '2026-11-25T17:00:00.000Z', gitBranch: 'main' });

describe('headInfo', () => {
  it('reads the account and the /clear time and branch', () => {
    expect(headInfo([line({ type: 'mode' }), owner, caveat, clear].join('\n'))).toEqual({ account: 'acc-1', startAt: Date.parse('2026-11-25T18:00:00.000Z'), clearAt: Date.parse('2026-11-25T18:00:05.041Z'), branch: 'main', done: true });
  });

  it('has no clear time when the first prompt is something else', () => {
    expect(headInfo([owner, prompt, clear].join('\n'))).toEqual({ account: 'acc-1', startAt: Date.parse('2026-11-25T17:00:00.000Z'), done: true });
  });

  it('is not done before the first prompt, and skips a cut-off last line', () => {
    expect(headInfo([owner, caveat, clear.slice(0, 40)].join('\n'))).toEqual({ account: 'acc-1', startAt: Date.parse('2026-11-25T18:00:00.000Z'), done: false });
  });
});

describe('scanInput', () => {
  it('links a /clear session to the chat it came from', () => {
    const at = Date.parse('2026-11-25T18:00:05.041Z');
    const list = [
      { sessionId: 'root', cwd: '/r', gitBranch: 'main', lastModified: at - 30_000 },
      { sessionId: 'other', cwd: '/r', gitBranch: 'feat', lastModified: at - 10_000 },
      { sessionId: 'sub', cwd: '/r', gitBranch: 'feat', lastModified: at + 60_000 },
    ];
    const heads = new Map([
      ['root', headInfo([owner, prompt].join('\n'))],
      ['other', headInfo([owner, prompt].join('\n'))],
      ['sub', headInfo([owner, caveat, clear].join('\n'))],
    ]);
    const input = scanInput(list, heads);
    expect(input[2]).toEqual({ sessionId: 'sub', cwd: '/r', branch: 'main', account: 'acc-1', lastAt: at + 60_000, clearAt: at });
    expect(linkOlder(input, {})).toEqual({ sub: { parent: 'root', via: 'clear', at } });
  });
});

describe('sent /clear', () => {
  const enqueue = (content: string, ts: string) => line({ type: 'queue-operation', operation: 'enqueue', timestamp: ts, sessionId: 'p', content });

  it('reads the times a chat queued /clear', () => {
    const text = [prompt, enqueue('/clear', '2026-11-25T17:22:06.981Z'), enqueue('Fix /clear handling', '2026-11-25T17:30:00.000Z')].join('\n');
    expect(sentClears(text)).toEqual([Date.parse('2026-11-25T17:22:06.981Z')]);
  });

  it('checks chats begun before an unlinked /clear, including ones resumed later, and matches the queued time', () => {
    const at = 100_000;
    const input = [
      { sessionId: 'resumed', cwd: '/r', branch: 'main', account: 'a', lastAt: at + 600_000 },
      { sessionId: 'later', cwd: '/r', branch: 'main', account: 'a', lastAt: at + 600_000 },
      { sessionId: 'stale', cwd: '/r', branch: 'main', account: 'a', lastAt: at - 300_000 },
      { sessionId: 'sub', cwd: '/r', branch: 'main', account: 'a', lastAt: at + 10_000, clearAt: at },
    ];
    const heads = new Map([['resumed', { account: 'a', startAt: 0, done: true }], ['later', { account: 'a', startAt: at + 5_000, done: true }], ['stale', { account: 'a', startAt: 0, done: true }]]);
    expect(maybeParents(input, {}, heads).map((s) => s.sessionId)).toEqual(['resumed']);
    expect(matchSent([50_000, at - 7], input[0], input)).toBe(at - 7);
  });
});
