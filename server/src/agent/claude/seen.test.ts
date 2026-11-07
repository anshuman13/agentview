import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let home: string;
let seen: typeof import('./seen.js');
let pins: typeof import('./pins.js');

beforeAll(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'seen-'));
  vi.stubEnv('HOME', home);
  seen = await import('./seen.js');
  pins = await import('./pins.js');
});

afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('seen route', () => {
  it('starts empty', async () => {
    expect(await seen.seenRoute('GET', null)).toEqual({ status: 200, body: {} });
  });

  it('stores now for an id, known or not', async () => {
    const before = Date.now();
    expect((await seen.seenRoute('POST', 'abc')).status).toBe(200);
    const body = (await seen.seenRoute('GET', null)).body as Record<string, number>;
    expect(body.abc).toBeGreaterThanOrEqual(before);
  });

  it('rejects a missing id and other methods', async () => {
    expect((await seen.seenRoute('POST', null)).status).toBe(400);
    expect((await seen.seenRoute('DELETE', 'abc')).status).toBe(405);
  });

  it('removing a chat drops its entry', async () => {
    await seen.seenRoute('POST', 'gone');
    await pins.removeChat('gone', true);
    expect(Object.keys((await seen.seenRoute('GET', null)).body as object)).toEqual(['abc']);
  });
});
