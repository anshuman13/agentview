import { describe, expect, test } from 'bun:test';
import { isNumericColumn, parseCsv, sniffDelimiter, sortRows } from './csv';

describe('csv', () => {
  test('parses quotes, escaped quotes, newlines in fields and CRLF', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n"two\nlines",3\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['two\nlines', '3']]);
  });

  test('keeps a last line without a newline and empty fields', () => {
    expect(parseCsv('﻿a,,c\n1,2,')).toEqual([['a', '', 'c'], ['1', '2', '']]);
  });

  test('sniffs the delimiter from the first line', () => {
    expect(sniffDelimiter('a;b;"c,d"\n1;2;3')).toBe(';');
    expect(sniffDelimiter('a\tb\n')).toBe('\t');
    expect(sniffDelimiter('a,b')).toBe(',');
    expect(sniffDelimiter('a,b', 'x.tsv')).toBe('\t');
  });

  test('sorts numbers as numbers and empty cells last', () => {
    const rows = [['10'], [''], ['9'], ['b'], ['a']];
    expect(sortRows(rows, 0, false).map((r) => r[0])).toEqual(['9', '10', 'a', 'b', '']);
    expect(sortRows(rows, 0, true).map((r) => r[0])).toEqual(['10', '9', 'b', 'a', '']);
    expect(isNumericColumn(rows, 0)).toBe(false);
    expect(isNumericColumn([['1.5'], [''], ['-2']], 0)).toBe(true);
  });
});
