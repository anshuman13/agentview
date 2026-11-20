import { describe, expect, it } from 'bun:test';
import { quoteText } from './composerText';

describe('quoteText', () => {
  it('quotes each line and ends with a blank line', () => {
    expect(quoteText('one line')).toBe('> one line\n\n');
    expect(quoteText('line one\nline two')).toBe('> line one\n> line two\n\n');
  });

  it('marks an empty inner line with a bare quote sign', () => {
    expect(quoteText('first\n\nsecond')).toBe('> first\n>\n> second\n\n');
  });

  it('trims surrounding blank lines', () => {
    expect(quoteText('\n\n  passage  \n\n')).toBe('> passage\n\n');
  });

  it('cuts a long passage at a word end', () => {
    const out = quoteText('word '.repeat(400));
    expect(out.endsWith('word ...\n\n')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(2 + 1500 + 4 + 2);
    expect(quoteText(`${'a'.repeat(1498)} bcd`)).toBe(`> ${'a'.repeat(1498)} ...\n\n`);
  });
});
