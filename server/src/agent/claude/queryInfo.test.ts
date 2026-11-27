import { describe, expect, it, vi } from 'bun:test';
import { contextUsage, loadUsage } from './queryInfo.js';

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

describe('contextUsage', () => {
  it('keeps the rows in the window and drops deferred tool schemas', () => {
    const u: any = { totalTokens: 900, maxTokens: 10_000, categories: [
      { id: 'messages', name: 'Messages', tokens: 800, kind: 'used', color: 'x' },
      { id: 'mcp_tools_deferred', name: 'MCP tools (deferred)', tokens: 5000, kind: 'deferred', color: 'x', isDeferred: true },
      { name: 'Free space', tokens: 9100, kind: 'free', color: 'x' },
    ] };
    expect(contextUsage(u)).toEqual({ total: 900, max: 10_000, rows: [
      { id: 'messages', name: 'Messages', tokens: 800, kind: 'used' },
      { id: 'Free space', name: 'Free space', tokens: 9100, kind: 'free' },
    ] });
  });
});
