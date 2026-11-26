import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { stubEnv, unstubAllEnvs } from '../../../testing.js';

let home: string;
let spawned: typeof import('./spawned.js');

beforeAll(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'spawned-'));
  stubEnv('HOME', home);
  spawned = await import('./spawned.js');
});

afterAll(() => {
  unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('spawn links', () => {
  it('records each child once, never a self link, and lists children oldest first', async () => {
    expect(await spawned.listSpawned()).toEqual({});
    await spawned.linkSpawned('c', 'p', 2);
    await spawned.linkSpawned('b', 'p', 1);
    await spawned.linkSpawned('b', 'q', 3);
    await spawned.linkSpawned('s', 's', 4);
    expect(await spawned.listSpawned()).toEqual({ b: { parent: 'p', kind: 'build', at: 1 }, c: { parent: 'p', kind: 'build', at: 2 } });
    expect(await spawned.spawnedOf('p')).toEqual(['b', 'c']);
    expect(await spawned.spawnedOf('q')).toEqual([]);
    expect(JSON.parse(fs.readFileSync(path.join(home, '.agentview', 'spawned.json'), 'utf8')).b.parent).toBe('p');
  });
});
