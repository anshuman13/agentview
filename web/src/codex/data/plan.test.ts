import { describe, expect, it } from 'vitest';
import { atRisk, defaultBlock, estimateMin, fitBlock, focusTitle, packDay, suggestEstimate, workGaps } from './plan';
import { goalProgress, goalsOf } from './goals';
import type { ItemRow } from './sync';

const at = (h: number, m = 0) => new Date(2026, 9, 30, h, m).getTime();

describe('estimateMin', () => {
  it('reads minutes, hours and both', () => {
    expect(estimateMin('Write doc ~30m')).toBe(30);
    expect(estimateMin('Review ~1h')).toBe(60);
    expect(estimateMin('Plan ~1h30m')).toBe(90);
    expect(estimateMin('Plan ~1h 30m')).toBe(90);
  });
  it('ignores titles without an estimate', () => {
    expect(estimateMin('About 30m of work')).toBeNull();
    expect(estimateMin('Fix ~0m')).toBeNull();
    expect(estimateMin(null)).toBeNull();
  });
});

describe('suggestEstimate', () => {
  it('averages actual minutes of 2 or more similar done tasks', () => {
    const done = (title: string, spent: number | null) => ({ title, status: 'done', spent });
    const past = [done('Write weekly report', 40), done('Write the weekly report ~30m', 20), done('Weekly report', null), done('Fix login bug', 90), { title: 'Write weekly report', status: 'open', spent: 60 }];
    expect(suggestEstimate('Write weekly report', past)).toBe(30);
    expect(suggestEstimate('Fix login bug', past)).toBeNull();
    expect(suggestEstimate('Plan trip', past)).toBeNull();
  });
});

describe('workGaps', () => {
  it('counts a running meeting only from now and clips to work hours', () => {
    const busy: [number, number][] = [[at(9), at(11)], [at(10, 30), at(12)], [at(14), at(18)]];
    expect(workGaps(busy, at(11), 8, 17)).toEqual([[at(12), at(14)]]);
  });
  it('starts at 08:00 before work and drops short gaps', () => {
    expect(workGaps([[at(8, 10), at(17)]], at(6))).toEqual([]);
    expect(workGaps([[at(9), at(17)]], at(6))).toEqual([[at(8), at(9)]]);
  });
});

describe('blocks', () => {
  it('starts on the next 5 minutes and uses the estimate or 30 minutes, capped at the gap', () => {
    expect(defaultBlock([at(10, 7), at(12)], 'Write doc ~1h')).toEqual([at(10, 10), at(11, 10)]);
    expect(defaultBlock([at(10), at(12)], 'Write doc')).toEqual([at(10), at(10, 30)]);
    expect(defaultBlock([at(10), at(10, 20)], 'Write doc ~1h')).toEqual([at(10), at(10, 20)]);
  });
  it('keeps a picked start inside the gap', () => {
    expect(fitBlock([at(10), at(12)], at(9, 55), 30)).toBeNull();
    expect(fitBlock([at(10), at(12)], at(11, 57), 30)).toBeNull();
    expect(fitBlock([at(10), at(12)], at(11, 45), 30)).toEqual([at(11, 45), at(12)]);
  });
  it('drops the estimate from the event title', () => {
    expect(focusTitle('Write doc ~30m today')).toBe('Focus: Write doc today');
  });
});

describe('packDay', () => {
  it('packs by due time then list order, skips gaps too short and leaves out what does not fit', () => {
    const tasks = [
      { title: 'Read notes', due: null },
      { title: 'Write doc ~1h', due: at(15) },
      { title: 'Reply to Mira ~45m', due: at(11) },
      { title: 'Huge job ~3h', due: at(16) },
    ];
    const out = packDay(tasks, [[at(9, 2), at(9, 40)], [at(10), at(12)]]);
    expect(out.map((p) => [p.task.title, p.span])).toEqual([
      ['Reply to Mira ~45m', [at(10), at(10, 45)]],
      ['Write doc ~1h', [at(10, 45), at(11, 45)]],
      ['Read notes', [at(9, 5), at(9, 35)]],
    ]);
  });
});

describe('weekly goals', () => {
  it('counts linked tasks done of total and plans goal tasks first', () => {
    const item = (id: string, o: Partial<ItemRow>) => ({ id, profile: 'work', deleted: 0, field_times: '{}', updated_at: 0, title: id, at: null, status: 'open', goal: null, ...o }) as ItemRow;
    const goal = item('Ship beta', { status: 'goal', at: new Date(2026, 9, 26).getTime() });
    const items = [goal, item('Write tests', { goal: goal.id, status: 'done' }), item('Fix login', { goal: goal.id }), item('Tidy inbox', {})];
    expect(goalsOf(items, at(10))).toEqual([goal]);
    const shifted = item('Other zone', { status: 'goal', at: new Date(2026, 9, 26, 9).getTime() });
    const nextWeek = item('Next week', { status: 'goal', at: new Date(2026, 10, 2).getTime() });
    expect(goalsOf([goal, shifted, nextWeek], at(10))).toEqual([goal, shifted]);
    expect(goalProgress(items, goal)).toEqual({ done: 1, total: 2 });
    const tasks = [{ title: 'Tidy inbox', due: at(11) }, { title: 'Fix login', due: null, goal: true }];
    expect(packDay(tasks, [[at(10), at(10, 30)]]).map((p) => p.task.title)).toEqual(['Fix login']);
  });
});

describe('atRisk', () => {
  const mon = (d: number, h: number, m = 0) => new Date(2026, 10, 2 + d, h, m).getTime();
  it('flags tasks whose summed estimates exceed the free time before their due time', () => {
    const busy: [number, number][] = [[mon(0, 8), mon(0, 16)], [mon(1, 8), mon(1, 17)]];
    const tasks = [
      { title: 'Slides ~1h', due: mon(0, 17) },
      { title: 'Budget ~30m', due: mon(1, 12) },
      { title: 'Late one', due: mon(-3, 9) },
      { title: 'Plan ~2h', due: mon(2, 10) },
      { title: 'Next week ~8h', due: mon(7, 9) },
    ];
    expect(atRisk(tasks, busy, mon(0, 7)).map((r) => [r.task.title, r.short])).toEqual([
      ['Late one', 30],
      ['Budget ~30m', 60],
      ['Plan ~2h', 60],
    ]);
  });
  it('is empty on the weekend', () => {
    expect(atRisk([{ title: 'Slides', due: mon(5, 9) }], [], mon(5, 8))).toEqual([]);
  });
});
