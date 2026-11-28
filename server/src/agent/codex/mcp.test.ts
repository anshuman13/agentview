import { describe, expect, it, vi } from 'bun:test';

const reply = { config: { mcp_servers: { grafana: { command: 'mcp-grafana' } } } };
vi.mock('./rpc.js', () => ({ CodexRpc: { openQuiet: async () => ({ request: async () => reply, close: () => {} }) } }));
vi.mock('../claude/mcp.js', () => ({ probeCached: async (_cwd: string, name: string, scope: string, def: { command?: string; env?: Record<string, string> }) => ({ name, scope, command: def.command, chat: def.env?.AGENTVIEW_CHAT }) }));
const { codexMcpProbe, codexServers } = await import('./mcp.js');

describe('codexServers', () => {
  it('maps a config/read reply to server definitions and drops disabled servers', () => {
    const reply = {
      config: {
        mcp_servers: {
          grafana: { command: 'mcp-grafana', args: ['-t', 'stdio'], env: { GRAFANA_URL: 'https://g.example' }, enabled: true },
          remote: { url: 'https://mcp.example/mcp', http_headers: { 'x-key': 'k' } },
          off: { command: 'nope', enabled: false },
        },
      },
    };
    expect(codexServers(reply)).toEqual({
      grafana: { command: 'mcp-grafana', args: ['-t', 'stdio'], env: { GRAFANA_URL: 'https://g.example' } },
      remote: { type: 'http', url: 'https://mcp.example/mcp', headers: { 'x-key': 'k' } },
    });
  });
  it('is empty when the config has no servers', () => {
    expect(codexServers({ config: {} })).toEqual({});
  });
});

describe('codexMcpProbe', () => {
  it('probes the agentview server besides the config servers', async () => {
    expect(await codexMcpProbe('/repo')).toEqual([
      { name: 'agentview', scope: 'codex', command: process.execPath, chat: 'mcp-probe' },
      { name: 'grafana', scope: 'codex', command: 'mcp-grafana', chat: undefined },
    ]);
  });
});
