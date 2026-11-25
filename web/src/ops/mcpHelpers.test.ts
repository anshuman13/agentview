import { describe, expect, it } from 'bun:test';
import type { ChatEvent } from '../../../shared/protocol';
import { argsOf, dotTone, fieldsOf, initialValues, mcpCalls, merge, moreMcpCounts, rowNote, services, stateOf, toolId } from './mcpHelpers';

describe('merge', () => {
  it('drops the probe error once the chat has the server connected', () => {
    const probed = [{ name: 'gw', status: 'needs-auth', scope: 'user', error: 'gw needs login (HTTP 401)' }];
    const live = JSON.parse(JSON.stringify([{ name: 'gw', status: 'connected', error: undefined }]));
    expect(merge(probed, live)[0]).toMatchObject({ status: 'connected', error: undefined, live: true, scope: 'user' });
  });

  it('keeps the probe latency when the chat reports the server', () => {
    const probed = [{ name: 'gw', status: 'connected', scope: 'user', ms: 120 }];
    expect(merge(probed, [{ name: 'gw', status: 'connected' }])[0].ms).toBe(120);
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

describe('fieldsOf', () => {
  it('maps a tool input schema to form fields and back to arguments', () => {
    const fields = fieldsOf({
      properties: {
        sql: { type: 'string', description: 'SQL to run' },
        name: { type: 'string' },
        limit: { type: 'integer', default: 10 },
        verbose: { type: 'boolean' },
        order: { type: 'string', enum: ['asc', 'desc'] },
        filter: { type: 'object' },
        since: { type: ['string', 'null'] },
      },
      required: ['sql', 'order'],
    });
    expect(fields.map((f) => [f.name, f.kind, f.required])).toEqual([
      ['sql', 'long', true], ['name', 'text', false], ['limit', 'integer', false], ['verbose', 'bool', false], ['order', 'enum', true], ['filter', 'json', false], ['since', 'text', false],
    ]);
    const values = initialValues(fields);
    expect(values).toEqual({ sql: '', name: '', limit: '10', order: '"asc"', filter: '', since: '' });
    expect(() => argsOf(fields, values)).toThrow('sql is required');
    expect(argsOf(fields, { ...values, sql: 'select 1', verbose: true, filter: '{"a":1}' })).toEqual({ sql: 'select 1', limit: 10, verbose: true, order: 'asc', filter: { a: 1 } });
    expect(() => argsOf(fields, { ...values, sql: 'x', limit: '1.5' })).toThrow('limit must be a whole number');
  });
});

describe('services', () => {
  it('groups variants by name prefix and takes the strongest kind', () => {
    const rows = [
      { name: 'billing_local', status: 'connected', command: 'toolbox --prebuilt postgres', tools: [{ name: 'execute_sql' }] },
      { name: 'billing_se_prod', status: 'needs-auth', type: 'http', command: 'https://example.com/mcp' },
      { name: 'metrics', status: 'connected', type: 'stdio', tools: [{ name: 'query' }] },
      { name: 'claude.ai Notes', status: 'connected', type: 'claudeai' },
    ];
    expect(services(rows).map((s) => [s.name, s.kind, s.variants.map((v) => v.variant)])).toEqual([
      ['billing', 'Databases', ['local', 'se_prod']],
      ['claude.ai Notes', 'Connectors', ['']],
      ['metrics', 'Tools', ['']],
    ]);
  });
});

describe('stateOf', () => {
  it('maps a server state to a badge status and reason', () => {
    expect(stateOf({ status: 'connected' })).toEqual(['done', 'Connected']);
    expect(stateOf({ status: 'failed' })).toEqual(['failed', 'Failed']);
    expect(stateOf({ status: 'needs-auth', live: true })).toEqual(['waiting', 'Needs login']);
    expect(stateOf({ status: 'probing' })).toEqual(['waiting', 'Checking']);
    expect(stateOf({ status: 'needs-auth' })).toEqual(['skipped', 'OAuth via Claude']);
    expect(stateOf({ status: 'disabled' })).toEqual(['skipped', 'Disabled']);
  });
});

describe('row dot and note', () => {
  it('tones the dot by status and says why a row is not connected', () => {
    expect(dotTone({ name: 'a', status: 'connected' })).toBe('ok');
    expect(dotTone({ name: 'a', status: 'pending' })).toBe('wait');
    expect(dotTone({ name: 'a', status: 'failed' })).toBe('bad');
    expect(dotTone({ name: 'a', status: 'needs-auth', live: true })).toBe('warn');
    expect(dotTone({ name: 'a', status: 'disabled' })).toBe('');
    expect(rowNote({ name: 'a', status: 'failed', error: 'spawn ENOENT' })).toBe('spawn ENOENT');
    expect(rowNote({ name: 'a', status: 'disabled' })).toBe('Disabled');
    expect(rowNote({ name: 'a', status: 'connected', scope: 'project' })).toBe('This repo');
    expect(rowNote({ name: 'claude.ai Slack', status: 'connected', type: 'claudeai' })).toBe('Claude.ai connector');
  });
});

describe('moreMcpCounts', () => {
  const chat = { connected: 21, total: 38, needsYou: 3 };
  it('uses the chat servers before the MCP page has loaded', () => expect(moreMcpCounts(null, chat)).toEqual(chat));
  it('uses the page section counts once loaded', () => {
    const page = { connected: 46, total: 103, needsYou: 57 };
    expect(moreMcpCounts(page, chat)).toEqual(page);
  });
});
