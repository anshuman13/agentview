import { describe, expect, test } from 'bun:test';
import { Readable } from 'node:stream';
import type http from 'node:http';
import { BadRequest, readJson } from './server.js';

const req = (body: string) => Readable.from([Buffer.from(body)]) as unknown as http.IncomingMessage;

describe('readJson', () => {
  test('returns an object body', async () => {
    expect(await readJson(req('{"profile":"work"}'), 100)).toEqual({ profile: 'work' });
  });

  test('rejects null, arrays, scalars and bad JSON as a bad request', async () => {
    for (const body of ['null', '[]', '5', '"x"', '{nope']) {
      await expect(readJson(req(body), 100)).rejects.toBeInstanceOf(BadRequest);
    }
  });

  test('passes a too large body through for a 413', async () => {
    await expect(readJson(req('{"a":"' + 'x'.repeat(200) + '"}'), 100)).rejects.toThrow('Request body too large');
  });
});
