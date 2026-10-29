import type http from 'node:http';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { readBody } from './body.js';

const req = (chunks: Buffer[]) => Readable.from(chunks) as unknown as http.IncomingMessage;

describe('readBody', () => {
  it('keeps a character split across chunks', async () => {
    const bytes = Buffer.from('blåbær 🍓');
    expect(await readBody(req([bytes.subarray(0, 3), bytes.subarray(3, 12), bytes.subarray(12)]))).toBe('blåbær 🍓');
  });

  it('refuses a body over the limit', async () => {
    await expect(readBody(req([Buffer.alloc(6)]), 5)).rejects.toThrow('too large');
  });
});
