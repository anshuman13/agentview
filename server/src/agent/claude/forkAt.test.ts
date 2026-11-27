import { describe, expect, it } from 'bun:test';
import type { SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import { replyUuid } from './forkAt.js';

const msg = (uuid: string, type: 'user' | 'assistant', text: string) => ({ uuid, type, message: { content: [{ type: 'text', text }] } }) as unknown as SessionMessage;
const msgs = [msg('u1', 'user', 'hi'), msg('a1', 'assistant', 'Same'), msg('u2', 'user', 'again'), msg('a2', 'assistant', 'Same\n')];

describe('replyUuid', () => {
  it('takes the uuid of a reply read from the transcript', () => {
    expect(replyUuid(msgs, { id: 'a1:0', text: 'Same' })).toBe('a1');
  });

  it('finds a streamed reply by its text, the latest first', () => {
    expect(replyUuid(msgs, { id: 'random', text: ' Same ' })).toBe('a2');
    expect(replyUuid(msgs, { id: 'random', text: 'hi' })).toBeNull();
  });
});
