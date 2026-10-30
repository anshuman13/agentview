import type { ChatEvent, McpSchema, McpServer } from '../../../shared/protocol';
import { plural } from '../ui/util';

export const STATUS: Record<string, [tone: string, label: string]> = {
  connected: ['ok', 'Connected'],
  failed: ['bad', 'Failed'],
  'needs-auth': ['warn', 'Needs login'],
  pending: ['wait', 'Connecting'],
  disabled: ['off', 'Disabled'],
  probing: ['wait', 'Checking'],
};
const statusOf = (s: string) => STATUS[s] ?? ['off', s];
export const needsYou = (r: { status: string; live?: boolean }) => r.status === 'failed' || (r.status === 'needs-auth' && !!r.live);
export const stateOf = (r: { status: string; live?: boolean; account?: string }): [tone: string, label: string] => (r.status === 'needs-auth' && !r.live && !r.account ? ['off', 'OAuth via Claude'] : statusOf(r.status));

const SCOPES: [id: string, title: string, where: string][] = [
  ['user', 'Your servers', '~/.claude.json'],
  ['project', 'This repo', '.mcp.json'],
  ['local', 'This folder', '~/.claude.json · project entry'],
  ['claudeai', 'Claude.ai connectors', 'claude.ai settings'],
  ['plugin', 'Plugins', 'Claude Code plugins'],
];
export const scopeInfo = (id: string) => SCOPES.find((s) => s[0] === id) ?? [id, id[0].toUpperCase() + id.slice(1), ''];

export const slug = (server: string) => server.replace(/[^A-Za-z0-9_-]/g, '_');
export const toolId = (server: string, tool: string) => `mcp__${slug(server)}__${tool}`;

export type Row = McpServer & { live?: boolean; account?: string };
export const rowKey = (r: Row) => (r.account ? `${r.account}:${r.name}` : r.name);

export function merge(probed: McpServer[], live: McpServer[]): Row[] {
  const rows: Row[] = probed.map((p) => ({ ...p }));
  for (const m of live) {
    const i = rows.findIndex((r) => r.name === m.name);
    const probedTools = rows[i]?.tools;
    const tools = m.tools?.some((t) => t.description) ? m.tools.map((t) => ({ inputSchema: probedTools?.find((p) => p.name === t.name)?.inputSchema, ...t })) : probedTools ?? m.tools;
    if (i >= 0) rows[i] = { ...rows[i], ...m, error: m.error, tools, scope: rows[i].scope ?? m.scope, live: true };
    else rows.push({ ...m, live: true });
  }
  return rows;
}

export type ToolResult = Extract<ChatEvent, { kind: 'tool_result' }>;
export type Call = { id: string; server: string; tool: string; input: Record<string, unknown>; at: number; result?: ToolResult };
export type Usage = { calls: Call[]; errors: number };

export function mcpCalls(events: ChatEvent[]): Map<string, Usage> {
  const results = new Map<string, ToolResult>();
  for (const e of events) if (e.kind === 'tool_result') results.set(e.toolUseId, e);
  const by = new Map<string, Usage>();
  for (const e of events) {
    if (e.kind !== 'tool_use' || !e.name.startsWith('mcp__') || e.name.endsWith('__set_status')) continue;
    const [, server, ...tool] = e.name.split('__');
    const result = results.get(e.id);
    const u = by.get(server) ?? { calls: [], errors: 0 };
    u.calls.push({ id: e.id, server, tool: tool.join('__'), input: e.input, at: e.at, result });
    if (result?.isError) u.errors++;
    by.set(server, u);
  }
  return by;
}

export { plural };
export const usageText = (u: Usage) => `${plural(u.calls.length, 'call')}${u.errors ? ` · ${plural(u.errors, 'error')}` : ''}`;
export const brief = (input: Record<string, unknown>) =>
  Object.entries(input).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ').replace(/\s+/g, ' ').slice(0, 160);

export type Field = { name: string; kind: 'text' | 'long' | 'number' | 'integer' | 'bool' | 'enum' | 'json'; required: boolean; description?: string; options?: unknown[]; default?: unknown };
type Values = Record<string, string | boolean>;
const LONG = /\b(sql|body|content|markdown|code|script|prompt|message|logql|promql|json|yaml|multi-?line)\b/i;

export function fieldsOf(schema?: McpSchema): Field[] {
  const required = new Set(schema?.required ?? []);
  return Object.entries(schema?.properties ?? {}).map(([name, p]) => {
    const type = [p.type].flat().find((t) => t && t !== 'null');
    const kind: Field['kind'] = p.enum?.length ? 'enum'
      : type === 'string' ? (LONG.test(`${name} ${p.description ?? ''}`) || (p.maxLength ?? 0) > 200 ? 'long' : 'text')
      : type === 'number' || type === 'integer' ? type
      : type === 'boolean' ? 'bool' : 'json';
    return { name, kind, required: required.has(name), description: p.description, options: p.enum, default: p.default };
  });
}

export function initialValues(fields: Field[]): Values {
  const v: Values = {};
  for (const f of fields) {
    if (f.kind === 'bool') { if (f.default !== undefined || f.required) v[f.name] = f.default === true; }
    else if (f.kind === 'enum') v[f.name] = f.default !== undefined ? JSON.stringify(f.default) : f.required ? JSON.stringify(f.options![0]) : '';
    else if (f.kind === 'json') v[f.name] = f.default !== undefined ? JSON.stringify(f.default, null, 2) : '';
    else v[f.name] = f.default !== undefined ? String(f.default) : '';
  }
  return v;
}

export function argsOf(fields: Field[], values: Values): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.name];
    if (f.kind === 'bool') { if (v !== undefined) args[f.name] = !!v; continue; }
    const s = typeof v === 'string' ? v : '';
    if (!s.trim()) { if (f.required) throw new Error(`${f.name} is required`); continue; }
    if (f.kind === 'number' || f.kind === 'integer') {
      const n = Number(s);
      if (!Number.isFinite(n) || (f.kind === 'integer' && !Number.isInteger(n))) throw new Error(`${f.name} must be ${f.kind === 'integer' ? 'a whole number' : 'a number'}`);
      args[f.name] = n;
    } else if (f.kind === 'enum' || f.kind === 'json') {
      try { args[f.name] = JSON.parse(s); } catch { throw new Error(`${f.name} is not valid JSON`); }
    } else args[f.name] = s;
  }
  return args;
}

export const runnable = (r: Row) => r.type !== 'claudeai' && r.type !== 'sse' && r.status !== 'needs-auth' && ['user', 'project', 'local'].includes(r.scope ?? '');

export type Kind = 'Databases' | 'Tools' | 'Connectors';
export type Service = { name: string; kind: Kind; variants: { variant: string; row: Row }[] };
export const KINDS: Kind[] = ['Databases', 'Tools', 'Connectors'];
const SQL_TOOL = /execute_sql|run_query|query_sql|list_tables/;
const SQL_CMD = /postgres|mysql|sqlite|toolbox/i;

const splitName = (name: string): [service: string, variant: string] => {
  const i = name.search(/[_-]/);
  return i > 0 ? [name.slice(0, i), name.slice(i + 1)] : [name, ''];
};

export const kindOf = (r: Row): Kind =>
  r.tools?.some((t) => SQL_TOOL.test(t.name)) || SQL_CMD.test(r.command ?? '') ? 'Databases' : r.type === 'claudeai' ? 'Connectors' : 'Tools';

export const rank = (k: Kind) => (k === 'Databases' ? 2 : k === 'Connectors' ? 1 : 0);

export function services(rows: Row[]): Service[] {
  const by = new Map<string, Service>();
  for (const row of rows) {
    const [name, variant] = splitName(row.name);
    const key = row.account ? `${row.account}:${name}` : name;
    const s = by.get(key) ?? { name, kind: 'Tools', variants: [] };
    s.variants.push({ variant, row });
    if (rank(kindOf(row)) > rank(s.kind)) s.kind = kindOf(row);
    by.set(key, s);
  }
  for (const s of by.values()) s.variants.sort((a, b) => a.variant.localeCompare(b.variant));
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type Group = 'work' | 'personal';

// claude.ai connectors belong to the chat's Claude account: alt is the work account, main the personal one.
export const accountGroup = (a: string): Group => (a === 'alt' ? 'work' : 'personal');
export const shortName = (name: string) => name.replace(/^claude\.ai /, '');
export const hideKey = (s: Service) => `hide:${s.name}`;
export const groupKey = (r: Row) => splitName(r.name)[0];
