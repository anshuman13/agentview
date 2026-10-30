import { expect, it } from 'bun:test';
import { openDb } from './db.js';
import { addBlock } from './block.js';

it('creates the event only for an open task, then moves the task and keeps the block', async () => {
  const db = openDb(':memory:');
  const item = db.prepare("INSERT INTO items (id, profile, version, updated_at, title, status) VALUES (?, 'work', 1, 0, ?, ?)");
  item.run('a', 'Write doc ~30m', 'open');
  item.run('b', 'Old', 'done');
  const made: string[] = [];
  const create = async (b: { id: string }) => (made.push(b.id), { url: 'https://cal/e' });
  const block = (id: string, start: number, end: number) => addBlock(() => db, { profile: 'work', id, start, end, title: 'Focus: x' }, create, () => 5);
  await expect(block('b', 1000, 2000)).rejects.toThrow('No such open task');
  await expect(block('a', 2000, 1000)).rejects.toThrow('Invalid start or end');
  expect(made).toEqual([]);
  await block('a', 1000, 2000);
  expect(made).toEqual(['a']);
  expect(db.prepare("SELECT at FROM items WHERE id = 'a'").get()).toEqual({ at: 1000 });
  expect(db.prepare("SELECT title, starts_at, ends_at, calendar_url FROM meetings WHERE id = 'block:a'").get()).toEqual({ title: 'Focus: x', starts_at: 1000, ends_at: 2000, calendar_url: 'https://cal/e' });
});
