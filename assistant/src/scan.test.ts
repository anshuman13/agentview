import { expect, test } from 'bun:test';
import type http from 'node:http';
import { openDb } from './db.js';
import { runScan, scanHealth } from './scan.js';
import { scanRoutes } from './routes/scan.js';

test('a failing scan keeps its last success and records the error', async () => {
  const db = openDb(':memory:');
  await runScan(db, 'slack', async () => ({ chats: 2 }));
  await expect(runScan(db, 'slack', async () => { throw new Error('token expired'); })).rejects.toThrow('token expired');
  const [h] = scanHealth(db, ['gmail']);
  expect(h).toMatchObject({ scan: 'slack', counts: { chats: 2 }, error: 'token expired' });
  expect(h.failed).toBeGreaterThanOrEqual(h.ok!);
  expect(scanHealth(db, ['gmail'])[1]).toEqual({ scan: 'gmail', missing: true });
});

test('scan now joins a running scan', async () => {
  const db = openDb(':memory:');
  let runs = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const route = scanRoutes({
    test: { setUp: () => true, paused: async () => false, run: (d) => runScan(d, 'test', async () => { runs++; await gate; return { n: 1 }; }) },
  })['POST /scan'];
  const call = () => {
    const out: { status?: number; body?: string } = {};
    const res = { writeHead: (s: number) => (out.status = s), end: (b: string) => (out.body = b) } as unknown as http.ServerResponse;
    return Promise.resolve(route({ req: {} as http.IncomingMessage, res, url: new URL('http://x/scan?name=test'), device: 'd', getDb: () => db })).then(() => out);
  };
  const a = call();
  const b = call();
  await Bun.sleep(5);
  release();
  expect(await Promise.all([a, b])).toEqual([{ status: 200, body: '{"counts":{"n":1}}' }, { status: 200, body: '{"counts":{"n":1}}' }]);
  expect(runs).toBe(1);
});
