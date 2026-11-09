import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItemRow } from '../data/sync';

const snacks: { text: string; undo?: () => void }[] = [];
vi.mock('../view', () => ({ FILTER_LABEL: {}, showSnack: (text: string, undo?: () => void) => snacks.push({ text, undo }) }));
vi.mock('../focus', () => ({ stopFocusFor: () => {} }));

const { bulkApply } = await import('../useActions');

const d = (day: number, h: number) => new Date(2026, 10, day, h).getTime();
const row = (id: string, extra: Partial<ItemRow> = {}) => ({ id, profile: 'personal', title: id, text: null, at: d(4, 10), status: 'open', deleted: 0, rolls: 2, rolled_from: 'x', ...extra }) as ItemRow;

function stub(items: ItemRow[]) {
  const made: ItemRow[] = [];
  const store = {
    snapshot: () => ({ items: [...items, ...made] }),
    update: async (r: ItemRow, patch: object) => { const l = items.some((x) => x.id === r.id) ? items : made; const i = l.findIndex((x) => x.id === r.id); l[i] = { ...l[i], ...patch }; },
    capture: async (text: string) => { const r = row(`n${made.length}`, { title: text }); made.push(r); return r; },
  };
  return { store: store as never, made };
}

beforeEach(() => { snacks.length = 0; });

describe('bulkApply', () => {
  it('patches every row, shows one snack and undo restores the prior fields', () => {
    const items = [row('a'), row('b'), row('c')];
    const { store } = stub(items);
    bulkApply(store, [...items], 'tomorrow', d(4, 12));
    expect(items.map((r) => r.at)).toEqual([d(5, 9), d(5, 9), d(5, 9)]);
    expect(items.map((r) => r.rolls)).toEqual([null, null, null]);
    expect(snacks).toHaveLength(1);
    expect(snacks[0].text).toBe('Moved 3 tasks to tomorrow morning');
    snacks[0].undo!();
    expect(items.map((r) => [r.at, r.rolls, r.rolled_from])).toEqual([[d(4, 10), 2, 'x'], [d(4, 10), 2, 'x'], [d(4, 10), 2, 'x']]);
  });

  it('undo skips a row edited since, and a second undo does nothing', () => {
    const items = [row('a'), row('b')];
    const { store } = stub(items);
    bulkApply(store, [...items], 'snooze', d(4, 12));
    items[1].at = d(8, 15);
    snacks[0].undo!();
    expect(items.map((r) => r.at)).toEqual([d(4, 10), d(8, 15)]);
    items[0].at = d(6, 9);
    snacks[0].undo!();
    expect(items[0].at).toBe(d(6, 9));
  });

  it('uses the later-of rule for snooze and singular text for one row', () => {
    const items = [row('a', { at: d(9, 10) })];
    const { store } = stub(items);
    bulkApply(store, [...items], 'snooze', d(4, 12));
    expect(items[0].at).toBe(d(10, 9));
    expect(snacks[0].text).toBe('Snoozed 1 task');
  });

  it('done creates the next repeat and undo deletes it', async () => {
    const items = [row('a', { text: 'Repeats: every day 09:00' }), row('b')];
    const { store, made } = stub(items);
    bulkApply(store, [...items], 'done');
    await new Promise((r) => setTimeout(r));
    expect(items.map((r) => r.status)).toEqual(['done', 'done']);
    expect(made).toHaveLength(1);
    expect(snacks).toHaveLength(1);
    snacks[0].undo!();
    await new Promise((r) => setTimeout(r));
    expect(items.map((r) => r.status)).toEqual(['open', 'open']);
    expect(made[0].deleted).toBe(1);
  });

  it('clear soft-deletes every row with one snack and undo restores them', () => {
    const items = [row('a', { status: 'done' }), row('b', { status: 'done' })];
    const { store } = stub(items);
    bulkApply(store, [...items], 'clear');
    expect(items.map((r) => r.deleted)).toEqual([1, 1]);
    expect(snacks).toHaveLength(1);
    expect(snacks[0].text).toBe('Cleared 2');
    snacks[0].undo!();
    expect(items.map((r) => r.deleted)).toEqual([0, 0]);
  });
});
