import { expect, test } from 'bun:test';
import { once } from './once.js';

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
