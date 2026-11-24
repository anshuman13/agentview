import { expect, it } from 'bun:test';
import { activity, outcomeLine } from './activity';
import type { LiveChat } from './protocol';

const chat = (id: string, lastActive: number, extra: Partial<LiveChat> = {}): LiveChat =>
  ({ id, sessionId: null, cwd: '/x', title: id, running: false, pending: 0, status: '', lastActive, ...extra });

it('takes the first sentence of the last reply', () => {
  expect(outcomeLine('Fixed **the** popup. Then I pushed.')).toBe('Fixed the popup.');
  expect(outcomeLine(undefined)).toBe('');
  expect(outcomeLine('x'.repeat(200)).length).toBe(90);
});

it('lists chats that finished today, newest first', () => {
  const rows = activity([
    chat('old', 5), chat('a', 20, { last: 'Done.' }), chat('run', 30, { running: true }), chat('ask', 30, { pending: 1 }),
    chat('b', 25, { failed: true }), chat('shown', 40),
  ], new Set(['shown']), 10);
  expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
  expect(rows[0]).toMatchObject({ line: 'Stopped with an error', failed: true });
  expect(rows[1].line).toBe('Done.');
});
