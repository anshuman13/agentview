import type { McpServer } from '../../../../shared/protocol.js';
import type { McpServerDef } from '../../integrations/mcpClient.js';
import { probeCached } from '../claude/mcp.js';
import { CodexRpc } from './rpc.js';

type RawServer = { command?: string; args?: string[]; env?: Record<string, string>; url?: string; http_headers?: Record<string, string>; enabled?: boolean };

// The servers a `config/read` reply lists under mcp_servers, as the definitions the MCP client starts.
export function codexServers(reply: { config?: { mcp_servers?: Record<string, RawServer> } }): Record<string, McpServerDef> {
  return Object.fromEntries(
    Object.entries(reply.config?.mcp_servers ?? {})
      .filter(([, s]) => s.enabled !== false)
      .map(([name, s]): [string, McpServerDef] => [name, s.url ? { type: 'http', url: s.url, headers: s.http_headers } : { command: s.command, args: s.args, env: s.env }]),
  );
}

export async function readCodexServers(cwd: string): Promise<Record<string, McpServerDef>> {
  const rpc = await CodexRpc.openQuiet(cwd);
  try {
    return codexServers(await rpc.request('config/read', { includeLayers: false, cwd }));
  } finally {
    rpc.close();
  }
}

export async function codexMcpProbe(cwd: string, refresh = false): Promise<McpServer[]> {
  const servers = await readCodexServers(cwd);
  return Promise.all(Object.entries(servers).map(([name, def]) => probeCached(cwd, name, 'codex', def, refresh)));
}
