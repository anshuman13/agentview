import { describe, expect, it } from 'vitest';
import { goalAtRisk, goalHistory, goalSummary, moveBlock, reopenBlock } from './goals';
import { weekFreeMinutes, type Span } from './plan';
import type { ItemRow } from '../sync';

const row = (o: Partial<ItemRow>) => ({ profile: 'work', deleted: 0, ...o }) as ItemRow;

describe('goalHistory', () => {
  const now = new Date(2026, 9, 28, 10).getTime();
  const mon = (weeksAgo: number) => new Date(2026, 9, 26 - 7 * weeksAgo).getTime();
  const g = (id: string, weeksAgo: number, o: Partial<ItemRow> = {}) => row({ id, title: id, status: 'goal', at: mon(weeksAgo), ...o });

  it('lists next week first, then this week and 7 past weeks, skipping empty weeks, deleted goals and older goals', () => {
    const items = [g('n', -1), g('a', 0), g('b', 1), g('c', 3), g('d', 7), g('old', 8), g('far', -2), g('gone', 2, { deleted: 1 })];
    const weeks = goalHistory(items, now);
    expect(weeks.map((w) => w.goals[0].id)).toEqual(['n', 'a', 'b', 'c', 'd']);
    expect(weeks.map((w) => w.start)).toEqual([mon(-1), mon(0), mon(1), mon(3), mon(7)]);
    expect(weeks.slice(0, 3).map((w) => w.label)).toEqual(['Next week', 'This week', 'Last week']);
    expect(weeks[3].label).toBe('Mon 5 Oct');
  });

  it('labels this week even when next week has no goals', () => {
    expect(goalHistory([g('a', 0)], now).map((w) => w.label)).toEqual(['This week']);
  });

  it('respects the profile', () => {
    const items = [g('a', 1), g('b', 2, { profile: 'personal' })];
    expect(goalHistory(items, now, 'personal').map((w) => w.goals[0].id)).toEqual(['b']);
  });
});

describe('reopenBlock', () => {
  const now = new Date(2026, 9, 28, 10).getTime();
  const cur = new Date(2026, 9, 26).getTime();
  const old = row({ id: 'o', title: 'Ship it', status: 'goal', at: new Date(2026, 9, 19).getTime() });
  const mine = (id: string, title: string, o: Partial<ItemRow> = {}) => row({ id, title, status: 'goal', at: cur, ...o });

  it('refuses at the goal limit of its own profile only', () => {
    const full = [mine('1', 'a'), mine('2', 'b'), mine('3', 'c')];
    expect(reopenBlock([old, ...full], old, now)).toBe('full');
    expect(reopenBlock([old, ...full.map((r) => ({ ...r, profile: 'personal' as const }))], old, now)).toBeNull();
    expect(reopenBlock([old, ...full.slice(0, 2), mine('4', 'd', { deleted: 1 })], old, now)).toBeNull();
  });

  it('refuses a same-title goal, ignoring case and spacing', () => {
    expect(reopenBlock([old, mine('1', '  SHIP it ')], old, now)).toBe('same');
    expect(reopenBlock([old, mine('1', 'Ship it', { profile: 'personal' })], old, now)).toBeNull();
  });
});

describe('moveBlock', () => {
  const now = new Date(2026, 9, 28, 10).getTime();
  const next = new Date(2026, 10, 2).getTime();
  const cur = row({ id: 'c', title: 'Ship it', status: 'goal', at: new Date(2026, 9, 26).getTime() });
  const nxt = (id: string, title: string, o: Partial<ItemRow> = {}) => row({ id, title, status: 'goal', at: next, ...o });

  it('refuses when next week is full for its profile only', () => {
    const full = [nxt('1', 'a'), nxt('2', 'b'), nxt('3', 'c')];
    expect(moveBlock([cur, ...full], cur, now)).toBe('full');
    expect(moveBlock([cur, ...full.map((r) => ({ ...r, profile: 'personal' as const }))], cur, now)).toBeNull();
    expect(moveBlock([cur, ...full.slice(0, 2), nxt('4', 'd', { deleted: 1 })], cur, now)).toBeNull();
  });

  it('refuses a same-title goal, ignoring case and spacing', () => {
    expect(moveBlock([cur, nxt('1', '  SHIP it ')], cur, now)).toBe('same');
    expect(moveBlock([cur, nxt('1', 'Ship it', { profile: 'personal' })], cur, now)).toBeNull();
  });
});

describe('goalAtRisk', () => {
  const fri = new Date(2026, 10, 6, 16).getTime();
  const sat = new Date(2026, 10, 7, 10).getTime();
  const goal = row({ id: 'g', status: 'goal' });
  const open = (n: number, o: Partial<ItemRow> = {}) => Array.from({ length: n }, (_, i) => row({ id: `t${i}`, status: 'open', goal: 'g', title: 'x', ...o }));
  const risk = (items: ItemRow[], now: number, busy: Span[] = []) => goalAtRisk(items, goal, weekFreeMinutes(busy, now));

  it('compares open estimates with the free minutes left', () => {
    expect(risk(open(1), fri)).toBe(false);
    expect(risk(open(2), fri)).toBe(false);
    expect(risk(open(3), fri)).toBe(true);
  });

  it('is at risk on the weekend only with open tasks', () => {
    expect(risk(open(1), sat)).toBe(true);
    expect(risk([...open(1, { status: 'done' })], sat)).toBe(false);
    expect(risk([], sat)).toBe(false);
  });

  it('counts a task with a focus block as open and takes busy spans as given', () => {
    const t = open(2, { title: 'x ~1h', at: fri + 1 });
    expect(risk(t, fri)).toBe(true);
    expect(risk(open(1), fri, [[fri, fri + 40 * 60_000]])).toBe(true);
  });
});

describe('goalSummary', () => {
  const goal = row({ id: 'g', status: 'goal' });
  it('lists open tasks before done ones and counts done over total', () => {
    const items = [goal, row({ id: 'a', status: 'done', goal: 'g' }), row({ id: 'b', status: 'open', goal: 'g' }), row({ id: 'c', status: 'open', goal: 'g' }), row({ id: 'x', status: 'open', goal: 'other' })];
    const s = goalSummary(items, goal);
    expect(s.tasks.map((t) => t.id)).toEqual(['b', 'c', 'a']);
    expect(s.count).toBe('1/3');
  });
  it('has no count without tasks', () => {
    expect(goalSummary([goal], goal)).toEqual({ tasks: [], count: undefined });
  });
});
