import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stubEnv, unstubAllEnvs } from '../../../../testing.js';

let home: string;
let seen: typeof import('./seen.js');
let pins: typeof import('./pins.js');

beforeAll(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'seen-'));
  stubEnv('HOME', home);
  seen = await import('./seen.js');
  pins = await import('./pins.js');
});

afterAll(() => {
  unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('seen route', () => {
  it('stores now for an id, known or not', async () => {
    const before = Date.now();
    expect((await seen.seenRoute('POST', 'abc')).status).toBe(200);
    const body = (await seen.seenRoute('GET', null)).body as Record<string, number>;
    expect(body.abc).toBeGreaterThanOrEqual(before);
  });

  it('stores 0 for an id marked unread', async () => {
    await seen.seenRoute('POST', 'abc', true);
    expect(((await seen.seenRoute('GET', null)).body as Record<string, number>).abc).toBe(0);
  });

  it('removing a chat drops its entry', async () => {
    await seen.seenRoute('POST', 'gone');
    await pins.removeChat('gone', true);
    expect(Object.keys((await seen.seenRoute('GET', null)).body as object)).toEqual(['abc']);
  });
});
