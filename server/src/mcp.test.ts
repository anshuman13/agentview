import { describe, expect, it } from 'vitest';
import { configEntries, mcpFrom } from './mcp.js';

describe('mcpFrom', () => {
  it('counts tools from the init tool list and hides the agentview server', () => {
    const tools = ['Bash', 'mcp__linear__get_issue', 'mcp__linear__list_issues', 'mcp__agentview__set_status'];
    expect(mcpFrom([{ name: 'linear', status: 'connected' }, { name: 'agentview', status: 'connected' }, { name: 'grafana', status: 'failed', error: 'boom' }], tools)).toEqual([
      { name: 'linear', status: 'connected', tools: 2, error: undefined },
      { name: 'grafana', status: 'failed', tools: undefined, error: 'boom' },
    ]);
  });

  it('prefers the tool list from mcpServerStatus', () => {
    expect(mcpFrom([{ name: 'linear', status: 'connected', tools: [{}, {}, {}] }])[0].tools).toBe(3);
  });
});

describe('configEntries', () => {
  it('infers the transport when type is missing', () => {
    expect(configEntries({ a: { command: 'x' } as never, b: { url: 'https://x' }, c: { type: 'sse' } }, 'project')).toEqual([
      { name: 'a', scope: 'project', type: 'stdio' },
      { name: 'b', scope: 'project', type: 'http' },
      { name: 'c', scope: 'project', type: 'sse' },
    ]);
  });
});
