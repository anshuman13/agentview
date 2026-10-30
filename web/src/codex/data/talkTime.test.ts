import { describe, expect, it } from 'vitest';
import { talkTime } from './talkTime';

describe('talkTime', () => {
  it('counts words after "Name: text" labels in the transcript part only', () => {
    const doc = [
      'Summary: Alex Smith and Sam Lee agreed on the plan.',
      'Transcript',
      '00:00:00',
      'Alex Smith: one two three four five six',
      'and seven eight',
      'Sam Lee: one two',
      '00:05:00',
      '**Alex Smith:** nine ten',
    ].join('\n');
    expect(talkTime(doc)).toEqual([
      { name: 'Alex Smith', words: 11, share: 11 / 13 },
      { name: 'Sam Lee', words: 2, share: 2 / 13 },
    ]);
  });

  it('reads a name line followed by its text', () => {
    const doc = ['Alex Smith', '00:00:10', 'one two three', 'Sam Lee', 'one', 'Alex Smith', 'four five six', 'Sam Lee', 'two three, okay.'].join('\n');
    expect(talkTime(doc).map((s) => [s.name, s.words])).toEqual([['Alex Smith', 6], ['Sam Lee', 4]]);
  });

  it('skips Markdown stamps and a one-off label without a transcript heading', () => {
    const doc = ['Summary: Alex Smith and Sam Lee agreed on the plan.', '### 00:00:00', 'Alex Smith: one two three', 'Sam Lee: one', '### 00:01:00', 'Alex Smith: four', 'Sam Lee: two'].join('\n');
    expect(talkTime(doc).map((s) => [s.name, s.words])).toEqual([['Alex Smith', 4], ['Sam Lee', 2]]);
  });

  it('finds no speakers in plain prose', () => {
    expect(talkTime('We talked about the plan.\nNothing else came up.')).toEqual([]);
  });
});
