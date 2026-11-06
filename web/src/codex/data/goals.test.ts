import { describe, expect, it } from 'vitest';
import { carryOver, goalAtRisk, goalHistory, goalVerdict, pruneDismissed, reopenBlock, reviewCarry, reviewWindow } from './goals';
import { weekFreeMinutes, type Span } from './plan';
import type { ItemRow } from './sync';

const row = (o: Partial<ItemRow>) => ({ profile: 'work', deleted: 0, ...o }) as ItemRow;

describe('carryOver', () => {
  const now = new Date(2026, 9, 28, 10).getTime();
  const lastMon = new Date(2026, 9, 19).getTime();
  const goals = [
    row({ id: 'g1', title: 'Ship', status: 'goal', at: lastMon }),
    row({ id: 'g2', title: 'Done', status: 'goal', at: lastMon }),
    row({ id: 'g3', title: 'Mine', status: 'goal', at: lastMon, profile: 'personal' }),
  ];
  const tasks = [row({ id: 't1', status: 'open', goal: 'g1' }), row({ id: 't2', status: 'done', goal: 'g2' })];

  it('returns last week goals that are not fully done', () => {
    expect(carryOver([...goals, ...tasks], now).map((g) => g.id)).toEqual(['g1', 'g3']);
    expect(carryOver([...goals, ...tasks], now, 'personal').map((g) => g.id)).toEqual(['g3']);
  });

  it('skips a profile once it has goals this week', () => {
    const cur = row({ id: 'g4', status: 'goal', at: new Date(2026, 9, 26).getTime() });
    expect(carryOver([...goals, ...tasks, cur], now, 'work')).toEqual([]);
    expect(carryOver([...goals, ...tasks, cur], now).map((g) => g.id)).toEqual(['g3']);
  });
});

describe('goalHistory', () => {
  const now = new Date(2026, 9, 28, 10).getTime();
  const mon = (weeksAgo: number) => new Date(2026, 9, 26 - 7 * weeksAgo).getTime();
  const g = (id: string, weeksAgo: number, o: Partial<ItemRow> = {}) => row({ id, title: id, status: 'goal', at: mon(weeksAgo), ...o });

  it('lists 8 weeks newest first, skipping empty weeks, deleted goals and older goals', () => {
    const items = [g('a', 0), g('b', 1), g('c', 3), g('d', 7), g('old', 8), g('gone', 2, { deleted: 1 })];
    const weeks = goalHistory(items, now);
    expect(weeks.map((w) => w.goals[0].id)).toEqual(['a', 'b', 'c', 'd']);
    expect(weeks.map((w) => w.start)).toEqual([mon(0), mon(1), mon(3), mon(7)]);
    expect(weeks.slice(0, 2).map((w) => w.label)).toEqual(['This week', 'Last week']);
    expect(weeks[2].label).toBe('Mon 5 Oct');
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

describe('weekly review', () => {
  const fri = new Date(2026, 9, 30, 14).getTime();
  const mon = new Date(2026, 9, 26).getTime();
  const nextMon = new Date(2026, 10, 2).getTime();
  const g = (id: string, title: string, o: Partial<ItemRow> = {}) => row({ id, title, status: 'goal', at: mon, ...o });

  it('window runs from Friday 14:00 through Sunday', () => {
    expect(reviewWindow(new Date(2026, 9, 30, 13, 59).getTime())).toBe(false);
    expect(reviewWindow(new Date(2026, 9, 30, 14, 0).getTime())).toBe(true);
    expect(reviewWindow(new Date(2026, 9, 31, 9).getTime())).toBe(true);
    expect(reviewWindow(new Date(2026, 10, 1, 23).getTime())).toBe(true);
    expect(reviewWindow(new Date(2026, 10, 2, 9).getTime())).toBe(false);
  });

  it('marks goals Done only when all linked tasks are done', () => {
    expect(goalVerdict({ done: 3, total: 3 })).toBe('Done');
    expect(goalVerdict({ done: 1, total: 3 })).toBe('Missed');
    expect(goalVerdict({ done: 0, total: 0 })).toBe('Missed');
  });

  it('carries Missed titles, skipping matches in next week case and space insensitively', () => {
    const r = reviewCarry([g('a', 'Ship it'), g('b', 'Write'), g('n', ' ship IT ', { at: nextMon })], fri, 'work');
    expect(r).toMatchObject({ titles: ['Write'], carried: 1, state: 'carry', next: nextMon });
  });

  it('has no room when next week holds 3 other goals', () => {
    const items = [g('a', 'A'), ...['x', 'y', 'z'].map((t) => g(t, t, { at: nextMon }))];
    expect(reviewCarry(items, fri, 'work')).toMatchObject({ titles: [], left: 1, state: 'full' });
  });

  it('leaves out titles beyond the room', () => {
    const items = [g('a', 'A'), g('b', 'B'), g('c', 'C'), g('x', 'X', { at: nextMon })];
    expect(reviewCarry(items, fri, 'work')).toMatchObject({ titles: ['A', 'B'], left: 1, state: 'carry' });
  });

  it('shows Carried over when all Missed goals are in next week, and none without Missed goals', () => {
    expect(reviewCarry([g('a', 'A'), g('n', 'a', { at: nextMon })], fri, 'work')).toMatchObject({ state: 'carried', carried: 1, left: 0 });
    expect(reviewCarry([g('a', 'A'), row({ id: 't', goal: 'a', status: 'done' })], fri, 'work').state).toBe('none');
  });

  it('takes next Monday across a clock change', () => {
    expect(reviewCarry([], new Date(2026, 9, 24, 15).getTime(), 'work').next).toBe(new Date(2026, 9, 26).getTime());
    expect(reviewCarry([], new Date(2026, 9, 25, 15).getTime(), 'work').next).toBe(new Date(2026, 9, 26).getTime());
  });

  it('keeps only today dismissals', () => {
    expect(pruneDismissed(['work:2026-10-30', 'personal:2026-10-29'], '2026-10-30')).toEqual(['work:2026-10-30']);
  });
});
