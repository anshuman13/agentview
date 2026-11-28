import { Database } from 'bun:sqlite';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { STATE_DIR } from '../agent/claude/accounts.js';
import { recordCall } from './calls.js';
import { callsSince, closeStore } from './store.js';

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

  it('keeps OpenRouter calls under their own key and provider', () => {
    expect(recordCall('openrouter', 's4', { id: 'gen_1', model: 'z-ai/glm-4.6', usage: usage(7) }, 4000)).toBe(true);
    expect(callsSince('openrouter', 0)).toEqual([
      { id: 'gen_1', at: 4000, account: 'openrouter', provider: 'openrouter', chat: 's4', model: 'z-ai/glm-4.6', input: 7, output: 14, cacheWrite: 21, cacheRead: 28, reasoning: 0, guessed: false },
    ]);
    expect(callsSince('main', 0)).toEqual([]);
  });
});
