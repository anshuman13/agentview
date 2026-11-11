import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stubEnv, unstubAllEnvs } from '../../../../testing.js';

let home: string;
let pins: typeof import('./pins.js');

beforeAll(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'pins-'));
  stubEnv('HOME', home);
  pins = await import('./pins.js');
});

afterAll(() => {
  unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('pins', () => {
  it('adds new pins first and ignores a repeat', async () => {
    await pins.pin('a');
    await pins.pin('b');
    await pins.pin('a');
    expect(await pins.listPins()).toEqual(['b', 'a']);
  });

  it('keeps the file on disk and ignores an unknown id', async () => {
    await pins.unpin('nope');
    expect(JSON.parse(fs.readFileSync(path.join(home, '.agentview', 'pins.json'), 'utf8'))).toEqual(['b', 'a']);
    await pins.unpin('b');
    expect(await pins.listPins()).toEqual(['a']);
  });

  it('removing a chat drops only its pin', async () => {
    await pins.pin('x');
    await pins.pin('y');
    await pins.removeChat('x', true);
    expect(await pins.listPins()).toEqual(['y', 'a']);
  });

  it('answers routes with 400 on a missing id and 405 on other methods', async () => {
    expect(await pins.pinsRoute('POST', null)).toEqual({ status: 400, body: { error: 'id is required' } });
    expect((await pins.pinsRoute('DELETE', '')).status).toBe(400);
    expect((await pins.pinsRoute('PUT', 'a')).status).toBe(405);
    expect(await pins.pinsRoute('POST', 'z')).toEqual({ status: 200, body: { ok: true } });
    expect((await pins.pinsRoute('GET', null)).body).toEqual(['z', 'y', 'a']);
    await pins.pinsRoute('DELETE', 'z');
    expect((await pins.pinsRoute('GET', null)).body).toEqual(['y', 'a']);
  });

  it('survives a module reload', async () => {
    const fresh = './pins.js?reload';
    const again: typeof import('./pins.js') = await import(fresh);
    expect(again).not.toBe(pins);
    expect(await again.listPins()).toEqual(['y', 'a']);
  });
});
