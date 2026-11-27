import { describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createArchiveOnClose } from './archiveOnClose.js';

function setup(state: { pr: string; linked: string[]; keep: string[] }) {
  const archived: string[] = [];
  const a = createArchiveOnClose({
    gh: async () => JSON.stringify({ state: state.pr }),
    file: path.join(mkdtempSync(path.join(os.tmpdir(), 'pr-archive-')), 'pr-archive.json'),
    linked: () => state.linked,
    keep: async () => new Set(state.keep),
    archive: async (id) => void archived.push(id),
    exists: () => true,
  });
  return { a, archived };
}

describe('archive on close', () => {
  it('bins the chats linked when armed and when the PR merged, skipping kept ones', async () => {
    const state = { pr: 'OPEN', linked: ['a'], keep: ['pinned'] };
    const { a, archived } = setup(state);
    await a.turn('/r', 5, true);
    expect([...(await a.armed('/r'))]).toEqual([5]);
    state.linked = [];
    await a.poll();
    expect(archived).toEqual([]);
    state.pr = 'MERGED';
    state.linked = ['b', 'pinned'];
    await a.poll();
    expect(archived).toEqual(['a', 'b']);
    expect((await a.armed('/r')).size).toBe(0);
  });

  it('turns off without binning anything', async () => {
    const state = { pr: 'CLOSED', linked: ['a'], keep: [] };
    const { a, archived } = setup(state);
    await a.turn('/r', 5, true);
    await a.turn('/r', 5, false);
    await a.poll();
    expect(archived).toEqual([]);
  });
});
