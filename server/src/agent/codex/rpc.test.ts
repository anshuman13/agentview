import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stubEnv, unstubAllEnvs, waitFor } from '../../../../testing.js';
import { codexAdmin } from './rpc.js';

const dir = mkdtempSync(path.join(os.tmpdir(), 'codex-stub-'));

// Answers every request with its own pid.
const stub = `#!${process.execPath}
for await (const line of console) {
  const msg = JSON.parse(line);
  if (msg.id !== undefined) console.log(JSON.stringify({ id: msg.id, result: { pid: process.pid } }));
}
`;

const pid = async (idleMs: number) => (await (await codexAdmin(idleMs)).request<{ pid: number }>('ping')).pid;
const alive = (p: number) => {
  try {
    process.kill(p, 0);
    return true;
  } catch {
    return false;
  }
};

describe('codexAdmin', () => {
  beforeAll(() => {
    const bin = path.join(dir, 'codex');
    writeFileSync(bin, stub);
    chmodSync(bin, 0o755);
    stubEnv('AGENTVIEW_CODEX', bin);
  });
  afterAll(() => {
    unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it('starts lazily, is shared, stops when idle and starts again', async () => {
    const first = await pid(800);
    expect(await pid(800)).toBe(first);
    await waitFor(() => expect(alive(first)).toBe(false), { timeout: 3000 });
    const second = await pid(800);
    expect(second).not.toBe(first);
    expect(await pid(800)).toBe(second);
  });
});
