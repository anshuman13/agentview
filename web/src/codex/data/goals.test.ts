import { describe, expect, it } from 'vitest';
import { carryOver, goalAtRisk } from './goals';
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
