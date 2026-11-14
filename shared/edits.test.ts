import { describe, expect, it } from 'bun:test';
import { replyLine, roundOf } from './edits';
import type { ChatEvent } from './protocol';

describe('roundOf', () => {
  it('reads each outcome and its summary', () => {
    expect(roundOf('Fixed it.\nROUND: done fixed the flaky test')).toEqual({ outcome: 'done', line: 'fixed the flaky test' });
    expect(roundOf('ROUND: progress half way')).toEqual({ outcome: 'progress', line: 'half way' });
    expect(roundOf('ROUND: blocked needs a token')).toEqual({ outcome: 'blocked', line: 'needs a token' });
    expect(roundOf('ROUND: question which branch?')).toEqual({ outcome: 'question', line: 'which branch?' });
    expect(roundOf('ROUND: nothing')).toEqual({ outcome: 'quiet', line: '' });
  });

  it('reads the line of a multiline reply and ignores a missing or unknown one', () => {
    expect(roundOf('One.\n\nTwo.\n\nround: Done - all green\n')).toEqual({ outcome: 'done', line: 'all green' });
    expect(roundOf('No line here.')).toBeNull();
    expect(roundOf('ROUND: maybe later')).toBeNull();
    expect(roundOf('ROUND: done early\nThen more text')).toBeNull();
  });
});

describe('stripRound', () => {
  it('keeps it out of the chat row line', () => {
    const events: ChatEvent[] = [{ id: 'a', kind: 'assistant', text: 'All checks pass.\nROUND: done checks pass', streaming: false, at: 1 }];
    expect(replyLine(events)).toBe('All checks pass.');
    expect(replyLine([{ ...events[0], text: 'ROUND: nothing' } as ChatEvent])).toBeUndefined();
  });
});
