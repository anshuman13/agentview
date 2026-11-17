import { describe, expect, it } from 'bun:test';
import { blockAt, blockAtOld, revertBlock } from './revertBlock';

describe('revertBlock', () => {
  const original = 'a\nb\nc\nd\ne\n';
  const content = 'a\nB\nc\nd\nE\n';

  it('leaves the other block in the diff', () => {
    const left = revertBlock(original, content, 0);
    expect(left).toBe('a\nb\nc\nd\nE\n');
    expect(blockAt(original, left, 5, false)).toBe(0);
    expect(blockAt(original, left, 2, false)).toBe(-1);
    expect(revertBlock(original, left, 0)).toBe(original);
  });

  it('finds the block of an added line and of removed lines above a line', () => {
    expect(blockAt(original, content, 5, false)).toBe(1);
    expect(blockAt(original, content, 2, true)).toBe(0);
    expect(blockAt(original, content, 3, false)).toBe(-1);
  });

  it('finds the block of a line of the original file', () => {
    expect(blockAtOld(original, content, 2)).toBe(0);
    expect(blockAtOld(original, content, 5)).toBe(1);
    expect(blockAtOld(original, content, 3)).toBe(-1);
  });
});
