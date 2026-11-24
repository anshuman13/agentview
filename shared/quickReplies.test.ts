import { expect, it } from 'bun:test';
import { QUICK_REPLIES, questionChoices, quickReplies } from './quickReplies';
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

it('offers the choices the question names', () => {
  expect(questionChoices('Should I keep the old one or remove it?')).toEqual(['Keep the old one', 'Remove it']);
  expect(questionChoices('Done. Want me to push now, or wait for review?')).toEqual(['Push now', 'Wait for review']);
  expect(questionChoices('Options:\n\n- **Rebase**: cleaner history\n- **Merge**: keeps both\n\nWhich one?')).toEqual(['Rebase', 'Merge']);
  expect(questionChoices('1. Club seats\n2. Floor seats\nWhich seats?')).toEqual(['Club seats', 'Floor seats']);
  expect(questionChoices('Should I push it?')).toEqual([]);
  expect(questionChoices('Is it a long sentence that goes on and on about one thing or is it really another very long thing?')).toEqual([]);
  expect(quickReplies([user, say('Keep it or drop it?')])).toEqual(['Keep it', 'Drop it']);
});
