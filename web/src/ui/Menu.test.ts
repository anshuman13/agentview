import { describe, expect, it } from 'vitest';
import { typeAhead } from './Menu';

describe('typeAhead', () => {
  const labels = ['Open', 'Skip', 'Snooze 1 hour', 'Snooze 1 day', 'Done'];

  it('moves to the next match after the current item', () => {
    expect(typeAhead(labels, 1, 's')).toBe(2);
    expect(typeAhead(labels, -1, 's')).toBe(1);
  });

  it('wraps past the end', () => {
    expect(typeAhead(labels, 3, 's')).toBe(1);
  });

  it('cycles on a repeated letter', () => {
    expect(typeAhead(labels, 2, 'ss')).toBe(3);
    expect(typeAhead(labels, 3, 'ss')).toBe(1);
  });

  it('keeps focus on a single matching item', () => {
    expect(typeAhead(['Only'], 0, 'o')).toBe(0);
  });

  it('ignores case and leading space', () => {
    expect(typeAhead([' Open', 'DONE'], 0, 'd')).toBe(1);
    expect(typeAhead([' Open', 'DONE'], 1, 'O')).toBe(0);
  });

  it('searches a multi-letter buffer from the current item inclusive', () => {
    expect(typeAhead(labels, 1, 'sn')).toBe(2);
    expect(typeAhead(labels, 3, 'sn')).toBe(3);
  });

  it('returns -1 without a match or items', () => {
    expect(typeAhead(labels, 0, 'x')).toBe(-1);
    expect(typeAhead([], -1, 's')).toBe(-1);
  });
});
