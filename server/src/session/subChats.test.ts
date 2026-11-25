import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { stubEnv, unstubAllEnvs } from '../../../testing.js';

let home: string;
let sub: typeof import('./subChats.js');

beforeAll(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'subchats-'));
  stubEnv('HOME', home);
  sub = await import('./subChats.js');
});

afterAll(() => {
  unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('sub-chat links', () => {
  it('starts empty and answers an unlinked id with itself', async () => {
    expect(await sub.listLinks()).toEqual({});
    expect(await sub.rootOf('a')).toBe('a');
    expect(await sub.childrenOf('a')).toEqual([]);
  });

  it('links every sub-chat of a chain to the root', async () => {
    await sub.linkSubChat('b', 'a', 'clear', 1);
    await sub.linkSubChat('c', 'b', 'build', 2);
    expect(await sub.listLinks()).toEqual({ b: { parent: 'a', via: 'clear', at: 1 }, c: { parent: 'a', via: 'build', at: 2 } });
    expect(await sub.rootOf('c')).toBe('a');
    expect(await sub.childrenOf('a')).toEqual(['b', 'c']);
    expect(await sub.groupOf('c')).toEqual(['a', 'b', 'c']);
    expect(await sub.groupOf('z')).toEqual(['z']);
  });

  it('keeps the first parent and never links a root to itself', async () => {
    await sub.linkSubChat('b', 'x', 'clear', 3);
    await sub.linkSubChat('a', 'c', 'clear', 4);
    expect(await sub.rootOf('b')).toBe('a');
    expect(await sub.rootOf('a')).toBe('a');
  });

  it('writes the file and reads it after a module reload', async () => {
    const file = JSON.parse(fs.readFileSync(path.join(home, '.agentview', 'subchats.json'), 'utf8'));
    expect(Object.keys(file)).toEqual(['b', 'c']);
    const again: typeof import('./subChats.js') = await import('./subChats.js?reload');
    expect(await again.childrenOf('a')).toEqual(['b', 'c']);
  });
});
