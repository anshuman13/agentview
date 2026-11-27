import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { editMarks, editPairs, replyLine, roundOf, type EditCount } from './edits';
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

describe('editPairs', () => {
  it('reads the old and new text of each edit tool', () => {
    expect(editPairs('Write', { file_path: 'a', content: 'x' })).toEqual([['', 'x']]);
    expect(editPairs('Edit', { old_string: 'a', new_string: 'b' })).toEqual([['a', 'b']]);
    expect(editPairs('MultiEdit', { edits: [{ old_string: 'a', new_string: 'b' }, { new_string: 'c' }] })).toEqual([['a', 'b'], ['', 'c']]);
    expect(editPairs('Bash', { command: 'ls' })).toBeNull();
  });
describe('editMarks', () => {
});

  const cases = JSON.parse(readFileSync(new URL('./fixtures/edit-marks.json', import.meta.url), 'utf8')) as { name: string; count: EditCount; expected: { add: string; del: string } }[];
  for (const c of cases) it(c.name, () => expect(editMarks(c.count)).toEqual(c.expected));
});
