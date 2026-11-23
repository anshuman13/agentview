import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'bun:test';

const asked: string[] = [];

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ options }: { options: { model: string } }) => {
    asked.push(options.model);
    return (async function* () { yield { type: 'result', subtype: 'success', result: '[]' }; })();
  },
}));
vi.mock('./accounts.js', () => ({ configDir: () => undefined, freshAccount: () => 'a', stopOnOverage: () => undefined }));

let dir: string;
let receipts: typeof import('./receipts.js');

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'receipts-'));
  receipts = await import('./receipts.js');
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('receipts', () => {
  it('reads a receipt with haiku and finds trips with sonnet', async () => {
    const file = path.join(dir, 'r.png');
    fs.writeFileSync(file, 'x');
    await receipts.readReceipt(file, 'image/png');
    await receipts.findTrips('2026-03-10 09:00 | 2026-03-10 10:00 | Flight | ');
    expect(asked).toEqual(['haiku', 'sonnet']);
  });
});
