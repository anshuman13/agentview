import { describe, expect, it } from 'vitest';
import { hunksOf, undoHunk } from './review';

const before = 'a\nb\nc\nd\ne\n';
const now = 'a\nB\nc\nd\nE\nf\n';

describe('hunksOf', () => {
  it('lists the runs of changed lines with their line in the new text', () => {
    expect(hunksOf(before, now)).toEqual([
      { line: 2, del: ['b'], add: ['B'] },
      { line: 5, del: ['e'], add: ['E', 'f'] },
    ]);
  });
});

describe('undoHunk', () => {
  it('puts back one hunk and leaves the other', () => {
    const [first] = hunksOf(before, now);
    expect(undoHunk(before, now, first)).toBe('a\nb\nc\nd\nE\nf\n');
  });

  it('finds the hunk after another one was undone', () => {
    const [first, second] = hunksOf(before, now);
    const left = undoHunk(before, now, first)!;
    expect(undoHunk(before, left, second)).toBe(before);
  });

  it('returns null when the file was edited since', () => {
    const [first] = hunksOf(before, now);
    expect(undoHunk(before, 'a\nBB\nc\nd\nE\nf\n', first)).toBeNull();
  });
});
