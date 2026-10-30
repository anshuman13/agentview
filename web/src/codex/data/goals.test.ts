import { describe, expect, it } from 'vitest';
import { carryOver } from './goals';
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
