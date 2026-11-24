import { expect, it } from 'bun:test';
import { QUICK_REPLIES, quickReplies } from './quickReplies';
import type { ChatEvent } from './protocol';

const say = (text: string, streaming = false): ChatEvent => ({ id: text, kind: 'assistant', text, streaming, at: 0 });
const user: ChatEvent = { id: 'u', kind: 'user', text: 'hi', at: 0 };

it('offers quick replies only after a finished question from the agent', () => {
  expect(quickReplies([user, say('Should I push it?')])).toEqual(QUICK_REPLIES);
  expect(quickReplies([user, say('Should I push it? ')])).toEqual(QUICK_REPLIES);
  expect(quickReplies([user, say('Should I push it?', true)])).toEqual([]);
  expect(quickReplies([user, say('Done.')])).toEqual([]);
  expect(quickReplies([say('Should I?'), user])).toEqual([]);
  expect(quickReplies([user, say('Ok?'), { id: 'r', kind: 'result', text: '', costUsd: 0, isError: false, at: 0 }])).toEqual(QUICK_REPLIES);
});
