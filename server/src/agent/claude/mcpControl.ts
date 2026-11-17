import type { McpServerConfig, Query } from '@anthropic-ai/claude-agent-sdk';
import { connectorStatus, inSettings, mcpFrom } from './mcp.js';

type McpAuth = { mcpAuthenticate(name: string): Promise<{ authUrl?: string; callbackPort?: number }> };

// The MCP servers of a chat's CLI process: the ones the process started with and the ones added since.
export class McpControl {
  servers: Record<string, McpServerConfig> = {};
  readonly added: Record<string, McpServerConfig> = {};

  constructor(private cwd: () => string, private current: () => Query | null, private open: () => Query) {}

  async status() {
    const list = await this.current()?.mcpServerStatus().catch(() => null);
    return list ? mcpFrom(list) : null;
  }

  async reconnect(name: string) {
    await this.current()?.reconnectMcpServer(name);
  }

  // A claude.ai connector logged in after the chat started stays needs-auth in the chat until it reconnects.
  async pickUpConnectors(account: string) {
    const q = this.current();
    const list = q && (await q.mcpServerStatus().catch(() => null));
    const stale = mcpFrom(list ?? []).filter((m) => m.type === 'claudeai' && m.status === 'needs-auth');
    if (!stale.length) return false;
    const known = await Promise.race([connectorStatus().catch(() => null), new Promise<null>((r) => setTimeout(r, 3000, null))]);
    const ready = stale.filter((m) => known?.[account]?.some((c) => c.name === m.name && c.status === 'connected'));
    for (const m of ready) await q!.reconnectMcpServer(m.name).catch(() => undefined);
    return ready.length > 0;
  }

  async toggle(name: string, enabled: boolean) {
    await this.current()?.toggleMcpServer(name, enabled);
  }

  async add(name: string, def: unknown) {
    this.open();
    if (await inSettings(this.cwd(), name)) return { error: undefined };
    this.added[name] = def as McpServerConfig;
    this.servers = { ...this.servers, [name]: def as McpServerConfig };
    const r = await this.current()!.setMcpServers(this.servers);
    return { error: r.errors[name] };
  }

  async login(name: string): Promise<{ authUrl?: string; callbackPort?: number }> {
    return (this.open() as Query & McpAuth).mcpAuthenticate(name);
  }
}
