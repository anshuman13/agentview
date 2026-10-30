import { describe, expect, test } from 'bun:test';
import { toParsed } from './parse.js';

describe('parse', () => {
  const now = new Date(2026, 9, 26, 12).getTime();

  test('reads a day as 09:00 and keeps the details', () => {
    expect(toParsed('call bank card thing', { title: ' Call the bank about the card ', details: 'Card ends 1234', due: '2026-10-27' }, now))
      .toEqual({ title: 'Call the bank about the card', details: 'Card ends 1234', at: new Date(2026, 9, 27, 9).getTime() });
  });

  test('drops a past due time and falls back to the text', () => {
    expect(toParsed('call bank', { title: '', details: ' ', due: '2026-10-25T10:00' }, now)).toEqual({ title: 'call bank', details: null, at: null });
    expect(toParsed('call bank', undefined, now)).toEqual({ title: 'call bank', details: null, at: null });
  });

  test('keeps today as the due day after 09:00', () => {
    expect(toParsed('call bank today', { title: 'Call the bank', details: null, due: '2026-10-26' }, now).at).toBe(new Date(2026, 9, 26, 9).getTime());
    expect(toParsed('call bank', { title: 'Call the bank', details: null, due: '2026-10-25' }, now).at).toBe(null);
  });
});
