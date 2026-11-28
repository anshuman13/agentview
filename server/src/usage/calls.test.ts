import { Database } from 'bun:sqlite';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { STATE_DIR } from '../agent/claude/accounts.js';
import { recordCall } from './calls.js';
import { closeStore } from './store.js';

const reset = () => {
  closeStore();
  for (const f of ['usage.db', 'usage.db-wal', 'usage.db-shm']) rmSync(path.join(STATE_DIR, f), { force: true });
};
beforeEach(reset);
afterAll(reset);

const usage = (n: number) => ({ input_tokens: n, output_tokens: n * 2, cache_creation_input_tokens: n * 3, cache_read_input_tokens: n * 4 });

describe('recordCall', () => {
  it('stores one row per message id', () => {
    expect(recordCall('alt', 's1', { id: 'msg_a', model: 'claude-opus', usage: usage(10) }, 1000)).toBe(true);
    expect(recordCall('alt', 's1', { id: 'msg_a', model: 'claude-opus', usage: usage(10) }, 2000)).toBe(false);
    expect(recordCall('alt2', 's2', { id: 'msg_b', model: 'claude-sonnet', usage: { input_tokens: 5 } }, 3000)).toBe(true);
    expect(recordCall('main', 's3', { model: 'claude-opus', usage: usage(1) })).toBe(false);
    closeStore();

    const db = new Database(path.join(STATE_DIR, 'usage.db'), { readonly: true });
    const rows = db.query('SELECT * FROM calls ORDER BY id').all();
    db.close();
    expect(rows).toEqual([
      { id: 'msg_a', at: 1000, account: 'alt', chat: 's1', model: 'claude-opus', input: 10, output: 20, cache_write: 30, cache_read: 40, guessed: 0, provider: 'claude', reasoning: 0 },
      { id: 'msg_b', at: 3000, account: 'alt2', chat: 's2', model: 'claude-sonnet', input: 5, output: 0, cache_write: 0, cache_read: 0, guessed: 0, provider: 'claude', reasoning: 0 },
    ]);
  });
});
