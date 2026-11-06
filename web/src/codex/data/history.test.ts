import { describe, expect, it } from 'vitest';
import { historyOf, historyTime } from './history';
import type { ItemRow } from './sync';

const row = (field_times: unknown, extra: Partial<ItemRow> = {}) => ({ id: 'a', status: 'open', at: null, assignee: null, field_times, ...extra }) as unknown as ItemRow;

describe('historyOf', () => {
  it('lists status, due and assignee newest first', () => {
    const h = historyOf(row(JSON.stringify({ status: 10, at: 30, assignee: 20, title: 40 }), { status: 'done', assignee: 'Sam' }));
    expect(h.map((e) => e.field)).toEqual(['at', 'assignee', 'status']);
    expect(h.map((e) => e.title)).toEqual(['Due date cleared', 'Assigned to Sam', 'Status: Done']);
  });
  it('says Unassigned and capitalises unknown statuses', () => {
    expect(historyOf(row({ assignee: 5, status: 4 }, { status: 'parked' } as Partial<ItemRow>)).map((e) => e.title)).toEqual(['Unassigned', 'Status: Parked']);
  });
  it('shows nothing for empty, malformed or non-object times', () => {
    for (const v of ['{}', 'nope', '', '[]', 'null']) expect(historyOf(row(v))).toEqual([]);
  });
  it('ignores zero, negative and non-numeric times', () => {
    expect(historyOf(row({ status: 0, at: -5, assignee: 'x' }))).toEqual([]);
    expect(historyOf(row({ status: '12' }))).toEqual([]);
  });
});

describe('historyTime', () => {
  it('uses the clock today, a weekday within a week, else a date', () => {
    const now = new Date(2026, 10, 6, 15).getTime();
    expect(historyTime(new Date(2026, 10, 6, 14, 20).getTime(), now)).toMatch(/14.20/);
    expect(historyTime(new Date(2026, 10, 3, 9).getTime(), now)).toBe(new Date(2026, 10, 3).toLocaleDateString([], { weekday: 'short' }));
    expect(historyTime(new Date(2026, 9, 20, 9).getTime(), now)).toBe(new Date(2026, 9, 20).toLocaleDateString([], { day: 'numeric', month: 'short' }));
  });
});
