import { ACCOUNT_LABEL, type Account, type ChatEvent, type McpSchema, type McpServer } from '../../../shared/protocol';
import type { BadgeSpec } from '../ui/Badge';
import { plural } from '../ui/util';

export const STATUS: Record<string, [status: BadgeSpec['status'], reason: string]> = {
  connected: ['done', 'Connected'],
  failed: ['failed', 'Failed'],
  'needs-auth': ['waiting', 'Needs login'],
  pending: ['waiting', 'Connecting'],
  disabled: ['skipped', 'Disabled'],
  probing: ['waiting', 'Checking'],
};
const statusOf = (s: string): [BadgeSpec['status'], string] => STATUS[s] ?? ['skipped', s];
export const stateOf = (r: { status: string; live?: boolean; account?: string }): [status: BadgeSpec['status'], reason: string] => (r.status === 'needs-auth' && !r.live && !r.account ? ['skipped', 'OAuth via Claude'] : statusOf(r.status));

const SCOPES: [id: string, title: string, where: string][] = [
  ['user', 'Your servers', '~/.claude.json'],
  ['project', 'This repo', '.mcp.json'],
  ['local', 'This folder', '~/.claude.json · project entry'],
  ['codex', 'Codex config', '~/.codex/config.toml'],
  ['claudeai', 'Claude.ai connectors', 'claude.ai settings'],
  ['plugin', 'Plugins', 'Claude Code plugins'],
];
export const scopeInfo = (id: string) => SCOPES.find((s) => s[0] === id) ?? [id, id[0].toUpperCase() + id.slice(1), ''];

export const slug = (server: string) => server.replace(/[^A-Za-z0-9_-]/g, '_');
export const toolId = (server: string, tool: string) => `mcp__${slug(server)}__${tool}`;

export const toggleConnector = (tools: string, id: string) => {
  const list = [...new Set(tools.split(',').map((t) => t.trim()).filter(Boolean))];
  return (list.includes(id) ? list.filter((t) => t !== id) : [...list, id]).join(', ');
};

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

// claude.ai connectors belong to the chat's Claude account: main is the personal one, the others are work.
export const accountGroup = (a: string): Group => (a === 'main' ? 'personal' : 'work');
export const shortName = (name: string) => name.replace(/^claude\.ai /, '');
export const hideKey = (s: { name: string }) => `hide:${s.name}`;
export const groupKey = (r: Row) => splitName(r.name)[0];

export type StatusGroup = 'Connected' | 'Needs login' | 'Failed' | 'Off';
export const STATUS_GROUPS: StatusGroup[] = ['Connected', 'Needs login', 'Failed', 'Off'];
export const statusGroup = (r: Row): StatusGroup =>
  r.status === 'connected' || r.status === 'pending' || r.status === 'probing' ? 'Connected'
  : r.status === 'needs-auth' ? 'Needs login' : r.status === 'failed' ? 'Failed' : 'Off';

export type Where = 'all' | 'servers' | Account;
export type Show = 'all' | 'connected' | 'not-connected' | 'hidden';
export type McpFilter = { show: Show; where: Where };
export const SHOWS: [Show, string][] = [['all', 'All servers'], ['connected', 'Connected'], ['not-connected', 'Not connected'], ['hidden', 'Hidden']];
const ACCOUNTS = Object.keys(ACCOUNT_LABEL) as Account[];

// Where a row comes from for the Source filter: a claude.ai account's connectors, or the configured servers.
export const whereOf = (r: Row): Exclude<Where, 'all'> => (r.type === 'claudeai' && r.account ? (r.account as Account) : 'servers');
export const whereLabel = (w: Where) => (w === 'all' ? 'All sources' : w === 'servers' ? 'Configured servers' : ACCOUNT_LABEL[w] ?? w);

// The table's Type and Source cells, like Claude's Connectors page: Web or Local with a tag, and the account or config it comes from.
export const typeOf = (r: Row) => (r.type === 'claudeai' || r.type === 'http' || r.type === 'sse' || r.command?.startsWith('http') ? 'Web' : 'Local');
export const tagOf = (r: Row) => ({ plugin: 'Plugin', project: 'Repo', local: 'Folder', codex: 'Codex' })[r.scope ?? ''] as string | undefined;
export const sourceOf = (r: Row) => (r.type === 'claudeai' ? (r.account ? ACCOUNT_LABEL[r.account as Account] ?? r.account : 'Claude.ai') : scopeInfo(r.scope ?? 'other')[1]);

const shows = (r: Row, show: Show, hidden: boolean) =>
  show === 'hidden' ? hidden : !hidden && (show === 'all' || (show === 'connected') === (statusGroup(r) === 'Connected'));

// The rows the filter lets through, by name; the same name from several accounts follows the Source order.
export function mcpList(rows: Row[], f: McpFilter, isHidden: (r: Row) => boolean): Row[] {
  const order = (r: Row) => ['servers', ...ACCOUNTS].indexOf(whereOf(r));
  return rows.filter((r) => shows(r, f.show, isHidden(r)) && (f.where === 'all' || whereOf(r) === f.where))
    .sort((a, b) => shortName(a.name).toLowerCase().localeCompare(shortName(b.name).toLowerCase()) || order(a) - order(b));
}

// Menu counts: the Show items count the rows the Source lets through, and the other way round. Empty sources are left out.
export function filterCounts(rows: Row[], f: McpFilter, isHidden: (r: Row) => boolean) {
  const show = (k: Show) => rows.filter((r) => shows(r, k, isHidden(r)) && (f.where === 'all' || whereOf(r) === f.where)).length;
  const where = (k: Where) => rows.filter((r) => shows(r, f.show, isHidden(r)) && (k === 'all' || whereOf(r) === k)).length;
  return {
    show: SHOWS.map(([k]): [Show, number] => [k, show(k)]),
    where: (['all', 'servers', ...ACCOUNTS] as Where[]).filter((k) => k === 'all' || rows.some((r) => whereOf(r) === k)).map((k): [Where, number] => [k, where(k)]),
  };
}

// A saved Source that has no rows any more falls back to All.
export const validFilter = (f: McpFilter, counts: ReturnType<typeof filterCounts>): McpFilter => ({
  show: SHOWS.some(([k]) => k === f.show) ? f.show : 'all',
  where: counts.where.some(([k]) => k === f.where) ? f.where : 'all',
});

// The page subtitle counts every row that is not hidden.
export const statusCounts = (rows: Row[]) => ({
  connected: rows.filter((r) => statusGroup(r) === 'Connected').length,
  total: rows.length,
  needsYou: rows.filter((r) => statusGroup(r) === 'Needs login' || statusGroup(r) === 'Failed').length,
});

type McpCounts = { connected: number; total: number; needsYou: number };
// The More sheet shows the MCP page's section counts once that page has loaded, else the chat's servers.
export const moreMcpCounts = (page: McpCounts | null, chat: McpCounts) => page ?? chat;

const TONE: Record<BadgeSpec['status'], string> = { done: 'ok', failed: 'bad', waiting: 'warn', skipped: '', sent: 'ok', late: 'bad', new: '', running: 'busy' };
// Dot tone for a row: connecting and checking rows shimmer, the rest follow their badge status.
export const dotTone = (r: Row) => (r.status === 'pending' || r.status === 'probing' ? 'wait' : TONE[stateOf(r)[0]]);

// One line under the name: the error or reason when not connected; connected rows need none, their section says where they come from.
export const rowNote = (r: Row) => {
  if (r.status === 'failed' && r.error) return r.error;
  const [status, reason] = stateOf(r);
  return status !== 'done' ? reason : undefined;
};

// A row matches when every word of the query is in its name, account, Type or Source cell, or its status note.
export function mcpMatches(r: Row, query: string) {
  const text = [r.name, r.account, sourceOf(r), typeOf(r), tagOf(r), rowNote(r)].filter(Boolean).join(' ').toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => text.includes(w));
}

// Claude's connector page splits tools into Interactive and Read-only; a server without read-only hints keeps one Tools list.
export function toolGroups<T extends { readOnly?: boolean }>(tools: T[]): [string, T[]][] {
  if (!tools.some((t) => t.readOnly)) return [['Tools', tools]];
  return ([['Interactive tools', tools.filter((t) => !t.readOnly)], ['Read-only tools', tools.filter((t) => t.readOnly)]] as [string, T[]][]).filter(([, l]) => l.length);
}

// Claude's line under a tool: "Takes 3 inputs: a, b, and c", naming the first three.
export function toolInputs(schema?: { properties?: Record<string, unknown> }): string | null {
  const names = Object.keys(schema?.properties ?? {});
  if (!names.length) return null;
  const shown = names.slice(0, 3);
  const list = names.length > 3 ? `${shown.join(', ')}, and ${names.length - 3} more` : shown.length > 1 ? `${shown.slice(0, -1).join(', ')}${shown.length > 2 ? ',' : ''} and ${shown.at(-1)}` : shown[0];
  return `Takes ${names.length} input${names.length > 1 ? 's' : ''}: ${list}`;
}
