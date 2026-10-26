import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { McpConfigEntry, McpSchema, McpServer, McpTool } from '../../../../shared/protocol.js';
import { callTool, probe, stop, text, type McpServerDef } from '../../integrations/mcpClient.js';

type Config = McpServerDef | undefined;
type Status = {
  name: string;
  status: string;
  error?: string;
  scope?: string;
  source?: string;
  serverInfo?: { name: string; version: string };
  config?: Config;
  tools?: { name: string; description?: string; annotations?: { readOnly?: boolean; destructive?: boolean } }[];
};

export const transport = (c: Config) => (c?.type === 'claudeai-proxy' ? 'claudeai' : c?.type ?? (c?.url ? 'http' : c?.command ? 'stdio' : undefined));
const commandOf = (c: Config) => c?.url ?? (c?.command ? [c.command, ...(c.args ?? [])].join(' ') : undefined);
const envOf = (c: Config) => (c?.env && Object.keys(c.env).length ? Object.keys(c.env) : undefined);

function toolsOf(s: Status, toolNames: string[]): McpTool[] | undefined {
  if (s.tools) return s.tools.map((t) => ({ name: t.name, description: t.description, readOnly: t.annotations?.readOnly, destructive: t.annotations?.destructive }));
  const prefix = `mcp__${s.name}__`;
  const names = toolNames.filter((t) => t.startsWith(prefix)).map((t) => ({ name: t.slice(prefix.length) }));
  return names.length ? names : undefined;
}

export function mcpFrom(list: Status[], toolNames: string[] = []): McpServer[] {
  return list
    .filter((s) => s.name !== 'agentview')
    .map((s) => ({
      name: s.name,
      status: s.status,
      scope: s.source ?? s.scope,
      type: transport(s.config) ?? (s.scope === 'claudeai' ? 'claudeai' : undefined),
      command: commandOf(s.config),
      env: envOf(s.config),
      version: s.serverInfo?.version,
      error: s.error,
      tools: toolsOf(s, toolNames),
    }));
}

export const readJson = (file: string) => readFile(file, 'utf8').then(JSON.parse).catch(() => ({}));

// ~/.claude.json and the repo's .mcp.json
export const readConfigs = (cwd: string) => Promise.all([readJson(path.join(os.homedir(), '.claude.json')), readJson(path.join(cwd, '.mcp.json'))]);

export function configEntries(servers: Record<string, Config> | undefined, scope: McpConfigEntry['scope']): McpConfigEntry[] {
  return Object.entries(servers ?? {}).map(([name, s]) => ({ name, scope, type: transport(s) ?? 'stdio', command: commandOf(s), env: envOf(s) }));
}

export async function mcpConfig(cwd: string): Promise<McpConfigEntry[]> {
  const [user, repo] = await readConfigs(cwd);
  return [...configEntries(user.mcpServers, 'user'), ...configEntries(user.projects?.[cwd]?.mcpServers, 'local'), ...configEntries(repo.mcpServers, 'project')];
}

type Def = { name: string; scope: McpConfigEntry['scope']; def: McpServerDef };

export function configDefs(user: any, repo: any, cwd: string): Def[] {
  const by = new Map<string, Def>();
  for (const [scope, servers] of [['user', user.mcpServers], ['project', repo.mcpServers], ['local', user.projects?.[cwd]?.mcpServers]] as const) {
    for (const [name, def] of Object.entries((servers ?? {}) as Record<string, McpServerDef>)) by.set(name, { name, scope, def });
  }
  return [...by.values()];
}

export async function configDef(cwd: string, name: string) {
  const [user, repo] = await readConfigs(cwd);
  return configDefs(user, repo, cwd).find((d) => d.name === name)?.def as McpServerConfig | undefined;
}

type Approval = { enableAllProjectMcpServers?: unknown; enabledMcpjsonServers?: unknown; disabledMcpjsonServers?: unknown };
const has = (list: unknown, name: string) => Array.isArray(list) && list.includes(name);

export function approved(name: string, sources: Approval[]) {
  if (sources.some((s) => has(s.disabledMcpjsonServers, name))) return false;
  return sources.some((s) => s.enableAllProjectMcpServers === true || has(s.enabledMcpjsonServers, name));
}

// The repo's own .claude/settings.json counts only once Claude Code's trust dialog was accepted for that folder.
const readApprovals = async (cwd: string, user: any): Promise<Approval[]> => {
  const project = user.projects?.[cwd] ?? {};
  const files = [path.join(os.homedir(), '.claude', 'settings.json'), path.join(cwd, '.claude', 'settings.local.json')];
  if (project.hasTrustDialogAccepted === true) files.push(path.join(cwd, '.claude', 'settings.json'));
  return [...(await Promise.all(files.map(readJson))), project];
};

// Servers Claude Code would start in this folder: user and local scope, plus approved project servers.
export async function allowedServers(cwd: string): Promise<Record<string, McpServerDef>> {
  const [user, repo] = await readConfigs(cwd);
  const sources = await readApprovals(cwd, user);
  return Object.fromEntries(configDefs(user, repo, cwd).filter((d) => runs(d, sources)).map((d) => [d.name, d.def]));
}

export const runs = (d: Def, sources: Approval[]) => d.scope !== 'project' || approved(d.name, sources);

export async function inSettings(cwd: string, name: string) {
  const [user, repo] = await readConfigs(cwd);
  const d = configDefs(user, repo, cwd).find((d) => d.name === name);
  return !!d && runs(d, await readApprovals(cwd, user));
}

export const authError = (msg: string) => /needs auth|HTTP 401|HTTP 403|unauthori[sz]ed/i.test(msg);

const rowOf = (name: string, scope: string, def: McpServerDef) => ({ name, scope, type: transport(def), command: commandOf(def), env: envOf(def) });

export async function probeOne(name: string, scope: string, def: McpServerDef, cwd?: string, run = probe): Promise<McpServer> {
  const base = rowOf(name, scope, def);
  if (base.type === 'sse') return { ...base, status: 'disabled', error: 'The MCP tab cannot probe SSE servers. Claude Code still connects to it in chats.' };
  const key = `probe:${cwd}:${name}:${JSON.stringify(def)}`;
  try {
    const { info, tools } = await run(key, def, cwd);
    return { ...base, status: 'connected', version: info?.version, tools: tools.map((t) => ({ name: t.name, description: t.description, readOnly: t.annotations?.readOnlyHint, destructive: t.annotations?.destructiveHint, inputSchema: t.inputSchema as McpSchema | undefined })) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ...base, status: authError(msg) ? 'needs-auth' : 'failed', error: msg };
  } finally {
    stop(key);
  }
}

const TTL = 60_000;
const cache = new Map<string, { at: number; done: boolean; row: Promise<McpServer> }>();

export async function mcpProbe(cwd: string, refresh = false): Promise<McpServer[]> {
  const [user, repo] = await readConfigs(cwd);
  const sources = await readApprovals(cwd, user);
  return Promise.all(
    configDefs(user, repo, cwd).map(async (d) => {
      const { name, scope, def } = d;
      if (!runs(d, sources)) return { ...rowOf(name, scope, def), status: 'disabled', error: 'Not approved in Claude Code, so AgentView does not start it' };
      const key = `${cwd}:${name}:${JSON.stringify(def)}`;
      const hit = cache.get(key);
      if (hit && (!hit.done || (!refresh && Date.now() - hit.at < TTL))) return hit.row;
      const entry = { at: Date.now(), done: false, row: probeOne(name, scope, def, cwd) };
      void entry.row.then(() => { entry.done = true; entry.at = Date.now(); });
      cache.set(key, entry);
      return entry.row;
    }),
  );
}

export async function mcpCall(cwd: string, name: string, def: McpServerDef, tool: string, args: Record<string, unknown>, run = callTool): Promise<{ text: string; isError: boolean } | { error: string }> {
  const type = transport(def);
  if (type === 'claudeai' || type === 'sse') return { error: `${name} is ${type === 'sse' ? 'an SSE server' : 'a claude.ai connector'}, so the MCP tab cannot run its tools. Ask Claude to use it in the chat.` };
  const key = `call:${cwd}:${name}:${JSON.stringify(def)}`;
  try {
    return { text: text(await run(key, def, tool, args, 60_000, cwd)), isError: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (authError(msg) || /needs login/.test(msg)) return { error: `${name} needs an OAuth login, so the MCP tab cannot run its tools. Ask Claude to use it in the chat.` };
    return { text: msg, isError: true };
  } finally {
    stop(key);
  }
}

const GROUPS = path.join(os.homedir(), '.agentview', 'mcp-groups.json');
export type McpGroups = Record<string, 'work' | 'personal'>;

export async function mcpGroups(): Promise<McpGroups> {
  const g = await readJson(GROUPS);
  const out: McpGroups = {};
  if (Array.isArray(g.personal)) for (const s of g.personal) if (typeof s === 'string') out[s] = 'personal';
  for (const [k, v] of Object.entries(g)) if (v === 'work' || v === 'personal') out[k] = v;
  return out;
}

export async function setMcpGroup(service: string, group: string): Promise<McpGroups> {
  const g = await mcpGroups();
  if (group === 'work' || group === 'personal') g[service] = group;
  else delete g[service];
  await mkdir(path.dirname(GROUPS), { recursive: true });
  await writeFile(GROUPS, JSON.stringify(g, null, 2));
  return g;
}
