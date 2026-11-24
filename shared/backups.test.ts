import { expect, it } from 'bun:test';
import { toPull } from './backups';

it('pulls backups that are missing or newer on the mini', () => {
  const remote = [
    { name: 'assistant-2026-11-24.db', size: 10, mtime: 200 },
    { name: 'travel-2026-11-24.tgz', size: 5, mtime: 100 },
    { name: 'travel-2026-11-23.tgz', size: 5, mtime: 50 },
    { name: '../etc.db', size: 1, mtime: 1 },
  ];
  const local = [{ name: 'assistant-2026-11-24.db', size: 10, mtime: 150 }, { name: 'travel-2026-11-24.tgz', size: 5, mtime: 100 }];
  expect(toPull(remote, local).map((f) => f.name)).toEqual(['assistant-2026-11-24.db', 'travel-2026-11-23.tgz']);
});
