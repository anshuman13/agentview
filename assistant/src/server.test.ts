import { describe, expect, test } from 'bun:test';
import { Readable } from 'node:stream';
import type http from 'node:http';
import { BadRequest } from '../../server/src/http/body.js';
import { fromAllowedPage } from './server.js';
import { readJson } from './routes/http.js';

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

test('fromAllowedPage lets the phone app and non-browser callers in, not other pages', () => {
  expect(fromAllowedPage({})).toBe(true);
  expect(fromAllowedPage({ origin: 'http://tauri.localhost' })).toBe(true);
  expect(fromAllowedPage({ origin: 'https://evil.test' })).toBe(false);
  expect(fromAllowedPage({ 'sec-fetch-site': 'cross-site' })).toBe(false);
});
