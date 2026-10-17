import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { McpConfigEntry, McpServer } from '../../shared/protocol.js';

type Status = { name: string; status: string; error?: string; tools?: unknown[] };
type Servers = Record<string, { type?: string; url?: string }> | undefined;

export function mcpFrom(list: Status[], toolNames: string[] = []): McpServer[] {
  return list
    .filter((s) => s.name !== 'agentview')
    .map((s) => ({
      name: s.name,
      status: s.status,
      tools: s.tools?.length ?? (toolNames.filter((t) => t.startsWith(`mcp__${s.name}__`)).length || undefined),
      error: s.error,
    }));
}

export const readJson = (file: string) => readFile(file, 'utf8').then(JSON.parse).catch(() => ({}));

export function configEntries(servers: Servers, scope: McpConfigEntry['scope']): McpConfigEntry[] {
  return Object.entries(servers ?? {}).map(([name, s]) => ({ name, scope, type: s.type ?? (s.url ? 'http' : 'stdio') }));
}

export async function mcpConfig(cwd: string): Promise<McpConfigEntry[]> {
  const [user, repo] = await Promise.all([readJson(path.join(os.homedir(), '.claude.json')), readJson(path.join(cwd, '.mcp.json'))]);
  return [...configEntries(user.mcpServers, 'user'), ...configEntries(user.projects?.[cwd]?.mcpServers, 'local'), ...configEntries(repo.mcpServers, 'project')];
}
