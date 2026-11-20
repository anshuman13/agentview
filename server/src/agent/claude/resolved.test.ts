import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { stubEnv, unstubAllEnvs } from '../../../../testing.js';

let home: string;
let resolved: typeof import('./resolved.js');

beforeAll(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'resolved-'));
  stubEnv('HOME', home);
  resolved = await import('./resolved.js');
});

afterAll(() => {
  unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('resolved questions route', () => {
  it('starts empty', async () => {
    expect(await resolved.resolvedRoute('GET', null)).toEqual({ status: 200, body: [] });
  });

  it('adds newest first and ignores a repeat', async () => {
    expect(await resolved.resolvedRoute('POST', 'a')).toEqual({ status: 200, body: { ok: true } });
    await resolved.resolvedRoute('POST', 'b');
    await resolved.resolvedRoute('POST', 'a');
    expect((await resolved.resolvedRoute('GET', null)).body).toEqual(['b', 'a']);
    expect(JSON.parse(fs.readFileSync(path.join(home, '.agentview', 'questions-resolved.json'), 'utf8'))).toEqual(['b', 'a']);
  });

  it('keeps the newest 500', async () => {
    for (let i = 0; i < 510; i++) await resolved.resolvedRoute('POST', `k${i}`);
    const list = (await resolved.resolvedRoute('GET', null)).body as string[];
    expect(list).toHaveLength(500);
    expect(list[0]).toBe('k509');
    expect(list[499]).toBe('k10');
  });

  it('answers 400 on a missing key and 405 on other methods', async () => {
    expect(await resolved.resolvedRoute('POST', null)).toEqual({ status: 400, body: { error: 'key is required' } });
    expect((await resolved.resolvedRoute('POST', '')).status).toBe(400);
    expect((await resolved.resolvedRoute('DELETE', 'a')).status).toBe(405);
  });
});
