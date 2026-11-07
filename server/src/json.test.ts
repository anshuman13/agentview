import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { jsonFile } from './json.js';

describe('jsonFile', () => {
  let dir: string;
  let file: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'jsonfile-'));
    file = path.join(dir, 'list.json');
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('returns the fallback when the file is missing', async () => {
    expect(await jsonFile<string[]>(file, []).read()).toEqual([]);
  });

  it('keeps both items from concurrent updates', async () => {
    const store = jsonFile<string[]>(file, []);
    await Promise.all(['a', 'b'].map((x) => store.update(async (cur) => {
      await new Promise((r) => setTimeout(r, 10));
      return [...cur, x];
    })));
    expect(JSON.parse(await readFile(file, 'utf8')).sort()).toEqual(['a', 'b']);
  });

  it('leaves the file alone when fn throws and runs the next update', async () => {
    const store = jsonFile<string[]>(file, []);
    await store.update(() => ['a']);
    await expect(store.update(() => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await store.read()).toEqual(['a']);
    expect(await store.update((cur) => [...cur, 'b'])).toEqual(['a', 'b']);
  });

  it('skips the write when fn returns the same reference', async () => {
    const store = jsonFile<string[]>(file, []);
    await store.update((cur) => cur);
    await expect(readFile(file, 'utf8')).rejects.toThrow();
  });
});
