import { describe, expect, it, vi } from 'bun:test';
import { loadUsage } from './queryInfo.js';

describe('loadUsage', () => {
  it('reads the usage once a minute per account, shared by its chats', async () => {
    const read = vi.fn(async () => ({}));
    const q: any = { usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: read };
    const host: any = { setSession: vi.fn() };
    await loadUsage(q, host, () => true, 'test-a', 1_000);
    await loadUsage(q, host, () => true, 'test-a', 30_000);
    await loadUsage(q, host, () => true, 'test-b', 30_000);
    await loadUsage(q, host, () => true, 'test-a', 61_000);
    expect(read).toHaveBeenCalledTimes(3);
    expect(host.setSession).toHaveBeenCalledTimes(4);
  });
});
