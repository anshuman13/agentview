import { expect, test } from 'bun:test';
import { openDb } from './db.js';
import { applyChanges } from './sync.js';
import { rollOver } from './rollover.js';

const at = (d: number, h: number) => new Date(2026, 9, d, h).getTime();
const item = (db: ReturnType<typeof openDb>, id: string, fields: Record<string, unknown>) => applyChanges(db, [{ table: 'items', id, profile: 'work', updated_at: 1, fields: { title: id, status: 'open', ...fields } }]);
const get = (db: ReturnType<typeof openDb>, id: string) => db.prepare('SELECT at, rolls, rolled_from, status FROM items WHERE id = ?').get(id) as { at: number; rolls: number | null; rolled_from: number | null; status: string };

test('moves open tasks from earlier days to today at the same time', () => {
  const db = openDb(':memory:');
  item(db, 'old', { at: at(26, 14) });
  item(db, 'today', { at: at(27, 8) });
  item(db, 'undated', { at: null });
  item(db, 'blank', { at: '' });
  item(db, 'done', { at: at(25, 9), status: 'done' });
  expect(rollOver(db, at(27, 10))).toBe(1);
  expect(get(db, 'old')).toEqual({ at: at(27, 14), rolls: 1, rolled_from: at(26, 14), status: 'open' });
  expect(get(db, 'today').rolls).toBeNull();
  expect(get(db, 'blank').rolls).toBeNull();
  expect(get(db, 'done').at).toBe(at(25, 9));
});

test('keeps the first due date and sends a task to review after three moves', () => {
  const db = openDb(':memory:');
  item(db, 'a', { at: at(20, 9) });
  rollOver(db, at(21, 1));
  rollOver(db, at(22, 1));
  expect(get(db, 'a')).toEqual({ at: at(22, 9), rolls: 2, rolled_from: at(20, 9), status: 'open' });
  rollOver(db, at(23, 1));
  expect(get(db, 'a')).toEqual({ at: at(23, 9), rolls: 3, rolled_from: at(20, 9), status: 'suggested' });
});

test('does not count weekend days toward review', () => {
  const db = openDb(':memory:');
  item(db, 'a', { at: at(23, 14) });
  for (const d of [24, 25, 26]) rollOver(db, at(d, 1));
  expect(get(db, 'a')).toEqual({ at: at(26, 14), rolls: 1, rolled_from: at(23, 14), status: 'open' });
});
