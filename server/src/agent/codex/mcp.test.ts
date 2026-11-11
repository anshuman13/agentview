import { describe, expect, it } from 'bun:test';
import { codexServers } from './mcp.js';

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
