import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type http from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BadRequest, parseObject, savePaste } from './body.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'pastes-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('parseObject', () => {
  it('parses objects and treats an empty body as {}', () => {
    expect(parseObject('{"a":1}')).toEqual({ a: 1 });
    expect(parseObject('  ')).toEqual({});
  });
  it.each(['null', '5', '[1]', '"x"', '{bad'])('rejects %s with a 400 error', (raw) => {
    expect(() => parseObject(raw)).toThrow(BadRequest);
    expect(new BadRequest('x').status).toBe(400);
  });
});

describe('savePaste', () => {
  it('removes pastes older than seven days and keeps recent ones', async () => {
    const old = path.join(dir, 'old.txt');
    await writeFile(old, 'x');
    await writeFile(path.join(dir, 'fresh.txt'), 'x');
    const eightDays = new Date(Date.now() - 8 * 86_400_000);
    await utimes(old, eightDays, eightDays);
    const saved = await savePaste(Readable.from([Buffer.from('hi')]) as unknown as http.IncomingMessage, 'a.txt', dir);
    await expect.poll(() => readdir(dir)).not.toContain('old.txt');
    const left = await readdir(dir);
    expect(left).toContain('fresh.txt');
    expect(left).toContain(path.basename(saved));
  });
});
