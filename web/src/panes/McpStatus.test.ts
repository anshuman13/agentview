import { describe, expect, it } from 'vitest';
import type { ChatEvent } from '../../../shared/protocol';
import { mcpCalls, merge, toolId } from './McpStatus';

describe('merge', () => {
  it('drops the probe error once the chat has the server connected', () => {
    const probed = [{ name: 'gw', status: 'needs-auth', scope: 'user', error: 'gw needs login (HTTP 401)' }];
    const live = JSON.parse(JSON.stringify([{ name: 'gw', status: 'connected', error: undefined }]));
    expect(merge(probed, live)[0]).toMatchObject({ status: 'connected', error: undefined, live: true, scope: 'user' });
  });
});

describe('mcpCalls', () => {
  it('groups MCP calls by server and pairs each with its result', () => {
    const use = (id: string, name: string): ChatEvent => ({ id, kind: 'tool_use', name, input: { q: id }, summary: name, at: 1 });
    const result = (toolUseId: string, isError: boolean): ChatEvent => ({ id: `r${toolUseId}`, kind: 'tool_result', toolUseId, text: 'out', isError, at: 2 });
    const events = [use('a', 'mcp__claude_ai_Linear__get_issue'), use('b', 'Read'), use('c', 'mcp__claude_ai_Linear__list_issues'), use('d', 'mcp__agentview__set_status'), result('a', false), result('c', true)];
    const linear = mcpCalls(events).get('claude_ai_Linear')!;
    expect(linear.errors).toBe(1);
    expect(linear.calls.map((c) => [c.tool, c.result?.isError])).toEqual([['get_issue', false], ['list_issues', true]]);
    expect(mcpCalls(events).has('agentview')).toBe(false);
    expect(toolId('claude.ai Linear', 'get_issue')).toBe('mcp__claude_ai_Linear__get_issue');
  });
});
