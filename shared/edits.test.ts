import { describe, expect, it } from 'vitest';
import { recapOf, replyLine, roundOf } from './edits';
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

describe('recapOf', () => {
  const user = (id: string): ChatEvent => ({ id, kind: 'user', text: 'go', at: 1 });
  const reply = (id: string, text: string, streaming = false): ChatEvent => ({ id, kind: 'assistant', text, streaming, at: 2 });
  const tool: ChatEvent = { id: 't', kind: 'tool_use', name: 'Bash', input: {}, summary: '', at: 2 };

  it('takes the first sentence of a reply after tool use', () => {
    expect(recapOf([user('u'), tool, reply('a', 'Fixed the flaky test. It raced the clock.')], false)).toBe('Fixed the flaky test.');
  });

  it('prefers the ROUND summary', () => {
    expect(recapOf([user('u'), tool, reply('a', 'Long text here.\nROUND: done checks pass')], false)).toBe('checks pass');
  });

  it('keeps a long ROUND line whole up to 400 characters', () => {
    const round = (n: number) => recapOf([user('u'), tool, reply('a', `Done.\nROUND: progress ${'word. '.repeat(n)}`.trimEnd())], false);
    expect(round(50)).toBe('word. '.repeat(50).trimEnd());
    expect(round(100)).toBe(`${'word. '.repeat(100).trimEnd().slice(0, 399).trimEnd()}…`);
  });

  it('skips a short reply without tool use and falls back to the turn before', () => {
    const events = [user('u1'), tool, reply('a1', 'Added the route.'), user('u2'), reply('a2', 'Yes.')];
    expect(recapOf(events, false)).toBe('Added the route.');
    expect(recapOf([user('u'), reply('a', 'x'.repeat(201))], false)).toBe(`${'x'.repeat(201)}`);
  });

  it('leaves out a turn that is still running', () => {
    const events = [user('u1'), tool, reply('a1', 'Added the route.'), user('u2'), tool, reply('a2', 'Wiring the page now.', true)];
    expect(recapOf(events, true)).toBe('Added the route.');
    expect(recapOf(events.slice(0, 2), true)).toBeUndefined();
  });
});
