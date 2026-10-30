import { describe, expect, it } from 'vitest';
import { nextRepeat, parseRepeat } from './recur';
import type { ItemRow } from './sync';

const d = (y: number, mo: number, day: number, h = 9, mi = 0) => new Date(y, mo, day, h, mi).getTime();
const row = (text: string, at: number | null, extra: Partial<ItemRow> = {}) => ({ id: 'a', profile: 'work', title: 'Pay', text, at, status: 'done', deleted: 0, ...extra }) as ItemRow;

describe('parseRepeat', () => {
  const now = new Date(2026, 9, 30, 10, 0);
  it('reads weekday names with a time', () => {
    expect(parseRepeat('Water plants every monday 9', now)).toEqual({ title: 'Water plants', text: 'Repeats: every monday 09:00', at: d(2026, 10, 2) });
    expect(parseRepeat('Gym every tue at 6:30pm', now)?.text).toBe('Repeats: every tuesday 18:30');
  });
  it('reads weekday, day and month rules', () => {
    expect(parseRepeat('Standup every weekday 9:30', now)).toMatchObject({ text: 'Repeats: every weekday 09:30', at: d(2026, 10, 2, 9, 30) });
    expect(parseRepeat('Stretch every day 15', now)).toMatchObject({ text: 'Repeats: every day 15:00', at: d(2026, 9, 30, 15) });
    expect(parseRepeat('Pay rent every month on the 1st', now)).toMatchObject({ title: 'Pay rent', text: 'Repeats: every month on the 1st 09:00', at: d(2026, 10, 1) });
  });
  it('uses the weekday of the first due for every week', () => {
    expect(parseRepeat('Review every week', now)).toMatchObject({ text: 'Repeats: every saturday 09:00', at: d(2026, 9, 31) });
  });
  it('ignores text without a rule or a title', () => {
    expect(parseRepeat('Call mom tomorrow', now)).toBeNull();
    expect(parseRepeat('every day', now)).toBeNull();
  });
});

describe('nextRepeat', () => {
  it('rolls a weekday rule over the weekend', () => {
    expect(nextRepeat(row('Repeats: every weekday 09:30', d(2026, 9, 30, 9, 30)), d(2026, 9, 30, 10))?.at).toBe(d(2026, 10, 2, 9, 30));
  });
  it('clamps the 31st to the month end', () => {
    const r = row('Repeats: every month on the 31st 09:00', d(2026, 0, 31));
    expect(nextRepeat(r, d(2026, 0, 31, 10))?.at).toBe(d(2026, 1, 28));
    expect(nextRepeat({ ...r, at: d(2026, 1, 28) }, d(2026, 1, 28, 10))?.at).toBe(d(2026, 2, 31));
  });
  it('moves past now when overdue', () => {
    expect(nextRepeat(row('Repeats: every day 09:00', d(2026, 9, 1)), d(2026, 9, 30, 10))?.at).toBe(d(2026, 9, 31));
  });
  it('keeps the wall clock time across a DST change', () => {
    expect(nextRepeat(row('Repeats: every day 09:00', d(2026, 2, 28)), d(2026, 2, 28, 10))?.at).toBe(d(2026, 2, 29));
    expect(nextRepeat(row('Repeats: every sunday 09:00', d(2026, 2, 22)), d(2026, 2, 22, 10))?.at).toBe(d(2026, 2, 29));
  });
  it('returns null for plain tasks and existing copies', () => {
    expect(nextRepeat(row('notes', 1), 2)).toBeNull();
    const r = row('Repeats: every day 09:00', d(2026, 9, 30));
    const copy = row('Repeats: every day 09:00', d(2026, 9, 31), { id: 'b', status: 'open' });
    expect(nextRepeat(r, d(2026, 9, 30, 10), [r, copy])).toBeNull();
  });
});
