import { describe, expect, test } from 'bun:test';
import { Readable } from 'node:stream';
import http from 'node:http';
import { BadRequest } from '../../server/src/http/body.js';
import { createServer, fromAllowedPage } from './server.js';
import { readJson } from './routes/http.js';
import { syncRoutes } from './routes/sync.js';

const req = (body: string) => Readable.from([Buffer.from(body)]) as unknown as http.IncomingMessage;

describe('readJson', () => {
  test('rejects null, arrays, scalars and bad JSON as a bad request', async () => {
    for (const body of ['null', '[]', '5', '"x"', '{nope']) {
      await expect(readJson(req(body), 100)).rejects.toBeInstanceOf(BadRequest);
    }
  });

  test('passes a too large body through for a 413', async () => {
    await expect(readJson(req('{"a":"' + 'x'.repeat(200) + '"}'), 100)).rejects.toThrow('Request body too large');
  });
});

test('GET /debug reports ASSISTANT_DEBUG=1 only', () => {
  const prev = process.env.ASSISTANT_DEBUG;
  const call = () => {
    let body = '';
    const res = { writeHead: () => {}, end: (b: string) => (body = b) };
    syncRoutes['GET /debug']({ res } as never);
    return JSON.parse(body);
  };
  process.env.ASSISTANT_DEBUG = '1';
  expect(call()).toEqual({ debug: true });
  process.env.ASSISTANT_DEBUG = '0';
  expect(call()).toEqual({ debug: false });
  delete process.env.ASSISTANT_DEBUG;
  expect(call()).toEqual({ debug: false });
  if (prev !== undefined) process.env.ASSISTANT_DEBUG = prev;
});

test('fromAllowedPage lets the phone app and non-browser callers in, not other pages', () => {
  expect(fromAllowedPage({})).toBe(true);
  expect(fromAllowedPage({ origin: 'http://tauri.localhost' })).toBe(true);
  expect(fromAllowedPage({ origin: 'https://evil.test' })).toBe(false);
  expect(fromAllowedPage({ 'sec-fetch-site': 'cross-site' })).toBe(false);
});

test('the hub refuses a Host that is not this Mac', async () => {
  const server = createServer().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address() as { port: number };
  const status = (host: string) =>
    new Promise<number>((resolve) =>
      http.get({ port, host: '127.0.0.1', path: '/nope', headers: { host } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      }),
    );
  expect(await status('evil.test:7790')).toBe(403);
  expect(await status(`localhost:${port}`)).toBe(404);
  server.close();
});
