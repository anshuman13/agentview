import { expect, test } from 'bun:test';
import { once, serial } from './once.js';

test('joins a running call per key and runs again after it settles', async () => {
  let runs = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const fn = async () => {
    const n = ++runs;
    await gate;
    return n;
  };
  const a = once('a', fn);
  const b = once('a', fn);
  const c = once('b', fn);
  expect(a).toBe(b);
  release();
  expect(await a).toBe(1);
  expect(await c).toBe(2);
  expect(await once('a', fn)).toBe(3);
});

test('frees the key after a failure', async () => {
  await expect(once('x', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  expect(await once('x', async () => 'ok')).toBe('ok');
});

test('serial runs calls per key in turn, past a failure', async () => {
  const log: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const a = serial('s', async () => { log.push('a'); await gate; throw new Error('boom'); });
  const b = serial('s', async () => { log.push('b'); return 2; });
  await Promise.resolve();
  expect(log).toEqual(['a']);
  release();
  await expect(a).rejects.toThrow('boom');
  expect(await b).toBe(2);
  expect(log).toEqual(['a', 'b']);
});
