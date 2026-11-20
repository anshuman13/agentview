import { describe, expect, it } from 'bun:test';
import type { LiveChat } from './protocol.js';
import { backgroundNotices } from './notices.js';

const chat = (c: Partial<LiveChat>) => ({ id: 'a', title: 'Fix tests', cwd: '/Users/me/agentview/', running: false, pending: 0, status: '', lastActive: 0, sessionId: 's1', ...c }) as LiveChat;

describe('backgroundNotices', () => {
  it('notifies when the chat on screen finishes', () => {
    const shown = chat({ running: true });
    expect(backgroundNotices([shown], [chat({})], () => false)).toEqual([{ id: 'a', notice: { kind: 'finished', title: 'Claude finished in agentview', body: 'Fix tests' } }]);
  });

  it('skips new chats and muted finishes', () => {
    expect(backgroundNotices([], [chat({ pending: 1 })], () => false)).toEqual([]);
    expect(backgroundNotices([chat({ running: true })], [chat({})], (s) => s === 's1')).toEqual([]);
  });
});
