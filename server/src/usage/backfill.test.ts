import { Database } from 'bun:sqlite';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { rememberAccount, STATE_DIR } from '../agent/claude/accounts.js';
import { backfill } from './backfill.js';
import { closeStore, getMeta } from './store.js';

const root = mkdtempSync(path.join(os.tmpdir(), 'usage-backfill-'));
const reset = () => {
  closeStore();
  for (const f of ['usage.db', 'usage.db-wal', 'usage.db-shm']) rmSync(path.join(STATE_DIR, f), { force: true });
};
beforeEach(reset);
afterAll(() => {
  reset();
  rmSync(root, { recursive: true, force: true });
});

const line = (sessionId: string, cwd: string, id: string, n: number, timestamp = '2026-11-20T12:00:00Z') =>
  JSON.stringify({
    type: 'assistant',
    sessionId,
    cwd,
    timestamp,
    message: { id, model: 'claude-opus', usage: { input_tokens: n, output_tokens: n * 2, cache_creation_input_tokens: n * 3, cache_read_input_tokens: n * 4 } },
  });

const write = (file: string, lines: string[]) => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), `${lines.join('\n')}\n`);
};

describe('backfill', () => {
  it('stores each transcript call once with its account', async () => {
    rememberAccount('known', 'alt2');
    const personal = path.join(os.homedir(), 'workspace_personal', 'app');
    const work = path.join(os.homedir(), 'workspace', 'svc');
    write('p1/known.jsonl', [
      JSON.stringify({ type: 'user', sessionId: 'known', message: { content: 'hi' } }),
      line('known', work, 'msg_1', 1),
      line('known', work, 'msg_1', 1),
      'not json "usage"',
      line('known', work, 'msg_2', 2),
    ]);
    write('p1/known/subagents/agent-a.jsonl', [line('known', work, 'msg_3', 3)]);
    write('p2/guess.jsonl', [line('guess', personal, 'msg_4', 4), line('guess-work', work, 'msg_5', 5)]);

    expect(await backfill(root)).toBe(5);
    expect(getMeta('backfilled_at')).toBeTruthy();
    closeStore();

    const db = new Database(path.join(STATE_DIR, 'usage.db'), { readonly: true });
    const rows = db.query('SELECT id, account, chat, input, output, cache_write, cache_read, guessed FROM calls ORDER BY id').all();
    db.close();
    expect(rows).toEqual([
      { id: 'msg_1', account: 'alt2', chat: 'known', input: 1, output: 2, cache_write: 3, cache_read: 4, guessed: 0 },
      { id: 'msg_2', account: 'alt2', chat: 'known', input: 2, output: 4, cache_write: 6, cache_read: 8, guessed: 0 },
      { id: 'msg_3', account: 'alt2', chat: 'known', input: 3, output: 6, cache_write: 9, cache_read: 12, guessed: 0 },
      { id: 'msg_4', account: 'main', chat: 'guess', input: 4, output: 8, cache_write: 12, cache_read: 16, guessed: 1 },
      { id: 'msg_5', account: 'alt', chat: 'guess-work', input: 5, output: 10, cache_write: 15, cache_read: 20, guessed: 1 },
    ]);

    expect(await backfill(root)).toBe(0);
  });
});
