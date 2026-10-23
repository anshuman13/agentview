import type http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { ROOTS, inside } from './worktrees.js';
import { allowedServers } from './mcp.js';
import { callTool, data, listTools, stop, stopAll, text, type McpResult, type McpServerDef } from './mcpClient.js';
import type {
  GrafanaDashboards,
  GrafanaLogs,
  GrafanaPatterns,
  LogPattern,
  ObserveConfig,
  ObserveInfo,
  SentryDetails,
  SentryIssue,
  SentryIssues,
  SentryTest,
  SnowflakeConfig,
  SnowflakeInfo,
  SnowflakeObjects,
  SnowflakeResult,
  SnowflakeTest,
} from '../../shared/observe.js';

const DIR = path.join(os.homedir(), '.agentview');
const FILE = path.join(DIR, 'observe.json');
const YAML = path.join(DIR, 'snowflake.yaml');
const CLAUDE = path.join(os.homedir(), '.claude.json');
const run = promisify(execFile);

type Settings = { sentryToken?: string; snowflake?: Partial<SnowflakeConfig>; repos?: Record<string, ObserveConfig> };
type Servers = Record<string, McpServerDef>;

const EMPTY_SNOWFLAKE: SnowflakeConfig = { account: '', user: '', warehouse: '', database: '', schema: '', role: '', auth: 'pat', secret: '' };

const EXAMPLE: Settings = {
  sentryToken: '',
  snowflake: EMPTY_SNOWFLAKE,
  repos: {
    example: {
      grafana: {
        url: 'https://your-org.grafana.net',
        query: 'example',
        dashboards: [{ title: 'Overview', url: 'https://your-org.grafana.net/d/abc123/overview', uid: 'abc123' }],
        lokiSelector: '{app="example"}',
      },
      sentry: { org: 'your-org', project: 'example', url: 'https://sentry.io' },
    },
  },
};

async function save(s: Settings) {
  await mkdir(DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(s, null, 2) + '\n', { mode: 0o600 });
}

async function load(): Promise<Settings> {
  const raw = await readFile(FILE, 'utf8').catch((err) => (err.code === 'ENOENT' ? null : Promise.reject(err)));
  if (raw === null) {
    await save(EXAMPLE);
    return EXAMPLE;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${FILE} is not valid JSON: ${(err as Error).message}`);
  }
}

async function repoName(cwd: string) {
  const root = ROOTS.find((r) => inside(cwd, r) && cwd !== r);
  if (root) return path.relative(root, cwd).split(path.sep)[0];
  const common = await run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd }).then((r) => r.stdout.trim()).catch(() => '');
  return path.basename(common ? path.dirname(common) : cwd);
}

async function hints(repo: string) {
  if (!/^[\w.-]+$/.test(repo) || repo.startsWith('.')) return '';
  const files = ROOTS.flatMap((r) => ['centro.yaml', 'catalog-info.yaml', '.sentryclirc', 'sentry.properties'].map((f) => path.join(r, repo, f)));
  return (await Promise.all(files.map((f) => readFile(f, 'utf8').catch(() => '')))).join('\n');
}

const pick = (re: RegExp, s: string) => s.match(re)?.[1]?.trim();

async function guess(repo: string, s: Settings): Promise<ObserveConfig> {
  const hint = await hints(repo);
  const others = Object.entries(s.repos ?? {}).filter(([k]) => k !== repo && k !== 'example').map(([, c]) => c);
  const slug = pick(/sentry\.io\/project-slug:\s*["']?([\w./-]+)/, hint)?.split('/');
  return {
    grafana: {
      url: others.find((c) => c.grafana?.url)?.grafana?.url ?? '',
      query: repo,
      dashboards: [],
      lokiSelector: pick(/grafana\/loki-selector:\s*'?(\{[^\n']*\})/, hint) ?? `{app="${repo}"}`,
    },
    sentry: {
      org: (slug?.length === 2 ? slug[0] : pick(/^\s*(?:defaults\.)?org\s*=\s*(\S+)/m, hint)) ?? others.find((c) => c.sentry?.org)?.sentry?.org ?? '',
      project: slug?.at(-1) ?? pick(/^\s*(?:defaults\.)?project\s*=\s*(\S+)/m, hint) ?? repo,
      url: others.find((c) => c.sentry?.url)?.sentry?.url ?? 'https://sentry.io',
    },
  };
}

async function configFor(repo: string, s: Settings) {
  return s.repos?.[repo] ?? (await guess(repo, s));
}

const userServers = (cwd: string): Promise<Servers> => allowedServers(cwd);

// One client per server definition, so a repo's grafana is never reused for another repo's.
const keyOf = (name: string, def: McpServerDef) => `${name}:${JSON.stringify(def)}`;

const httpsUrl = (u: string) => {
  if (!u) return u;
  const parsed = new URL(u);
  if (parsed.protocol !== 'https:') throw new Error('Sentry URL must use https');
  return parsed.origin;
};

const envToken = () => process.env.SENTRY_AUTH_TOKEN || process.env.SENTRY_ACCESS_TOKEN || '';
const sentryToken = (s: Settings) => envToken() || s.sentryToken || '';
const tokenSource = (s: Settings): ObserveInfo['sentryTokenSource'] => (envToken() ? 'env' : s.sentryToken ? 'file' : 'none');

const snowflakeInfo = (s: Settings): SnowflakeInfo => {
  const { secret, ...rest } = { ...EMPTY_SNOWFLAKE, ...s.snowflake };
  return { ...rest, hasSecret: !!secret };
};

async function info(repo: string, cwd: string): Promise<ObserveInfo> {
  const [s, servers] = await Promise.all([load(), userServers(cwd)]);
  return {
    repo,
    config: s.repos?.[repo] ?? null,
    guess: await guess(repo, s),
    repos: Object.keys(s.repos ?? {}),
    file: FILE,
    sentryToken: !!sentryToken(s),
    sentryTokenSource: tokenSource(s),
    sentryServer: servers.sentry ? 'config' : sentryToken(s) ? 'npx' : 'none',
    grafanaServer: !!servers.grafana,
    snowflake: snowflakeInfo(s),
    inClaude: { sentry: !!servers.sentry, snowflake: !!servers.snowflake },
  };
}

function grafanaDef(servers: Servers) {
  const def = servers.grafana;
  if (!def) throw new Error('No grafana MCP server in ~/.claude.json. Add one with: claude mcp add grafana -s user -e GRAFANA_URL=... -e GRAFANA_API_KEY=... -- mcp-grafana');
  return def;
}

const grafanaBase = (def: McpServerDef, cfg: ObserveConfig['grafana']) => (cfg?.url || def.env?.GRAFANA_URL || '').replace(/\/$/, '');
const RANGE = { startRfc3339: 'now-1h', endRfc3339: 'now' };
const ERRORS = '|~ "(?i)(error|exception|traceback|fatal|panic)"';

const lokiCache = new Map<string, string>();

async function lokiUid(def: McpServerDef, cfg: ObserveConfig['grafana']) {
  if (cfg?.lokiUid) return cfg.lokiUid;
  const key = grafanaBase(def, cfg);
  if (lokiCache.has(key)) return lokiCache.get(key)!;
  const r = data(await callTool(keyOf('grafana', def), def, 'list_datasources', { type: 'loki' })) as { datasources?: { uid: string }[] } | null;
  const uid = r?.datasources?.[0]?.uid;
  if (!uid) throw new Error('Grafana has no Loki datasource; set grafana.lokiUid in the settings');
  lokiCache.set(key, uid);
  return uid;
}

async function exploreLink(def: McpServerDef, uid: string, expr: string) {
  const args = { resourceType: 'explore', datasourceUid: uid, queries: [{ refId: 'A', expr }], timeRange: { from: 'now-1h', to: 'now' } };
  const r = await callTool(keyOf('grafana', def), def, 'generate_deeplink', args).catch(() => null);
  const url = r ? text(r).trim() : '';
  return /^https?:\/\//.test(url) ? url : undefined;
}

function selectorOf(cfg: ObserveConfig['grafana']) {
  const sel = cfg?.lokiSelector?.trim();
  if (!sel || !/^\{.*\}$/.test(sel)) throw new Error('Set grafana.lokiSelector (for example {app="comida"}) in the settings');
  return sel;
}

const nsToIso = (ts: unknown) => {
  const digits = String(ts ?? '').replace(/\D/g, '');
  return digits ? new Date(Number(BigInt(digits) / 1_000_000n)).toISOString() : '';
};

async function dashboards(repo: string, cfg: ObserveConfig['grafana'], def: McpServerDef): Promise<GrafanaDashboards> {
  const query = cfg?.query?.trim() || repo;
  const r = data(await callTool(keyOf('grafana', def), def, 'search_dashboards', { query, limit: 20 })) as { dashboards?: Record<string, string>[] } | null;
  const base = grafanaBase(def, cfg);
  const found = (r?.dashboards ?? []).map((d) => ({ uid: d.uid, title: d.title, url: d.url?.startsWith('/') ? base + d.url : d.url, folder: d.folderTitle }));
  const pinned = (cfg?.dashboards ?? []).map((d) => ({ uid: d.uid ?? '', title: d.title, url: d.url }));
  const seen = new Set<string>();
  const all = [...pinned, ...found].filter((d) => d.url && !seen.has(d.url) && seen.add(d.url));
  return { dashboards: all, link: base ? `${base}/dashboards?query=${encodeURIComponent(query)}` : undefined };
}

async function logs(cfg: ObserveConfig['grafana'], def: McpServerDef): Promise<GrafanaLogs> {
  const logql = `${selectorOf(cfg)} ${ERRORS}`;
  const uid = await lokiUid(def, cfg);
  const r = data(await callTool(keyOf('grafana', def), def, 'query_loki_logs', { datasourceUid: uid, logql, limit: 50, direction: 'backward', ...RANGE })) as any;
  const lines = (r?.data ?? []).map((e: any) => ({ ts: nsToIso(e.timestamp), line: String(e.line ?? ''), level: e.structuredMetadata?.detected_level ?? e.labels?.level ?? e.labels?.severity }));
  const link = await exploreLink(def, uid, logql);
  return { logs: lines, link, scanned: Number(r?.metadata?.totalLinesScanned) || 0 };
}

function collectPatterns(v: unknown, out: LogPattern[] = []): LogPattern[] {
  if (Array.isArray(v)) v.forEach((x) => collectPatterns(x, out));
  else if (v && typeof v === 'object') {
    const o = v as Record<string, any>;
    if (typeof o.pattern === 'string') {
      const count = typeof o.count === 'number' ? o.count : Array.isArray(o.samples) ? o.samples.reduce((n: number, s: unknown[]) => n + (Number(s[1]) || 0), 0) : 0;
      out.push({ pattern: o.pattern, count });
    } else Object.values(o).forEach((x) => collectPatterns(x, out));
  }
  return out;
}

const normalize = (line: string) => line.replace(/\b[0-9a-f]{8,}\b/gi, '<id>').replace(/\d+(\.\d+)?/g, '<n>').replace(/\s+/g, ' ').trim().slice(0, 240);

async function patterns(cfg: ObserveConfig['grafana'], def: McpServerDef): Promise<GrafanaPatterns> {
  const selector = selectorOf(cfg);
  const uid = await lokiUid(def, cfg);
  const tools = new Set((await listTools('grafana', def)).map((t) => t.name));
  const link = await exploreLink(def, uid, `${selector} ${ERRORS}`);
  const notes: string[] = [];
  const rank = (rows: LogPattern[]) => rows.sort((a, b) => b.count - a.count).slice(0, 20);
  if (tools.has('query_loki_patterns')) {
    try {
      const rows = collectPatterns(data(await callTool(keyOf('grafana', def), def, 'query_loki_patterns', { datasourceUid: uid, logql: selector, ...RANGE })));
      if (rows.length) return { patterns: rank(rows), source: 'Loki patterns', link };
      notes.push('Loki patterns: none');
    } catch (e) {
      notes.push(`Loki patterns: ${(e as Error).message.split('\n')[0]}`);
    }
  }
  if (tools.has('find_error_pattern_logs')) {
    try {
      const labels = Object.fromEntries([...selector.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]));
      const rows = collectPatterns(data(await callTool(keyOf('grafana', def), def, 'find_error_pattern_logs', { name: `agentview ${selector}`, labels, start: new Date(Date.now() - 3600_000).toISOString() }, 60_000)));
      if (rows.length) return { patterns: rank(rows), source: 'Sift', link };
      notes.push('Sift: none');
    } catch (e) {
      notes.push(`Sift: ${(e as Error).message.split('\n')[0]}`);
    }
  }
  const r = data(await callTool(keyOf('grafana', def), def, 'query_loki_logs', { datasourceUid: uid, logql: `${selector} ${ERRORS}`, limit: 100, format: 'compact', ...RANGE })) as any;
  const counts = new Map<string, number>();
  const lines: string[] = (r?.data ?? []).flatMap((e: any) => (Array.isArray(e.lines) ? e.lines.map((l: any) => String(l.line ?? l ?? '')) : [String(e.line ?? '')]));
  for (const l of lines) {
    const k = normalize(l);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const rows = rank([...counts].map(([pattern, count]) => ({ pattern, count })));
  return { patterns: rows, source: `grouped from the last ${lines.length} error lines${notes.length ? ` (${notes.join('; ')})` : ''}`, link };
}

type SentrySource = { def: McpServerDef; via: 'config' | 'npx' };

function sentrySource(servers: Servers, s: Settings, sentry: ObserveConfig['sentry']): SentrySource | null {
  if (servers.sentry) return { def: servers.sentry, via: 'config' };
  const token = sentryToken(s);
  if (!token) return null;
  const host = sentry?.url ? new URL(sentry.url).host : '';
  const args = ['-y', '@sentry/mcp-server@latest'];
  if (host && host !== 'sentry.io') args.push(`--host=${host}`);
  return { def: { type: 'stdio', command: 'npx', args, env: { SENTRY_ACCESS_TOKEN: token } }, via: 'npx' };
}

function sentryTarget(cfg: ObserveConfig) {
  const sentry = cfg.sentry;
  if (!sentry?.org || !sentry.project) throw new Error('Set sentry.org and sentry.project in the settings');
  const base = sentry.url ? new URL(sentry.url).origin : 'https://sentry.io';
  return { org: sentry.org, project: sentry.project, base };
}

function field(block: string, ...names: string[]) {
  for (const n of names) {
    const m = block.match(new RegExp(`\\*\\*${n}\\*\\*:\\s*(.*)`, 'i'));
    if (m) return m[1].trim();
  }
  return '';
}

function parseIssues(md: string, base: string, org: string): SentryIssue[] {
  return md
    .split(/^##\s+/m)
    .slice(1)
    .map((block) => {
      const shortId = block.split('\n')[0].replace(/[*`#]/g, '').trim();
      const title = field(block, 'Description', 'Title') || block.split('\n').slice(1).find((l) => l.trim())?.trim() || shortId;
      return {
        id: field(block, 'ID', 'Issue ID') || shortId,
        shortId,
        title,
        culprit: field(block, 'Culprit'),
        count: Number(field(block, 'Occurrences', 'Events', 'Count').replace(/\D/g, '')) || 0,
        userCount: Number(field(block, 'Users Impacted', 'Users').replace(/\D/g, '')) || 0,
        lastSeen: field(block, 'Last Seen'),
        permalink: field(block, 'URL', 'Link') || `${base}/organizations/${org}/issues/?query=${encodeURIComponent(shortId)}`,
        level: field(block, 'Level').toLowerCase(),
      };
    })
    .filter((i) => i.shortId);
}

async function sentryGet(token: string, url: string) {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sentry REST ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<any>;
}

async function restIssues(token: string, t: ReturnType<typeof sentryTarget>): Promise<SentryIssue[]> {
  const list: Array<Record<string, any>> = await sentryGet(token, `${t.base}/api/0/projects/${encodeURIComponent(t.org)}/${encodeURIComponent(t.project)}/issues/?query=is:unresolved&sort=date&limit=25`);
  return list.map((i) => ({
    id: String(i.id),
    shortId: i.shortId ?? '',
    title: i.title ?? '',
    culprit: i.culprit ?? '',
    count: Number(i.count) || 0,
    userCount: Number(i.userCount) || 0,
    lastSeen: i.lastSeen ?? '',
    permalink: i.permalink ?? '',
    level: i.level ?? '',
  }));
}

async function restDetails(token: string, t: ReturnType<typeof sentryTarget>, id: string) {
  const ev: Record<string, any> = await sentryGet(token, `${t.base}/api/0/organizations/${encodeURIComponent(t.org)}/issues/${encodeURIComponent(id)}/events/latest/`);
  const out = [`${ev.title ?? ''}`, ev.message ? `message: ${ev.message}` : '', `event ${ev.eventID ?? ''} at ${ev.dateCreated ?? ''}`, ''];
  for (const entry of ev.entries ?? []) {
    if (entry.type !== 'exception') continue;
    for (const ex of entry.data?.values ?? []) {
      out.push(`${ex.type}: ${ex.value}`);
      for (const f of ex.stacktrace?.frames ?? []) {
        out.push(`  at ${f.function ?? '?'} (${f.filename ?? f.absPath ?? '?'}:${f.lineNo ?? '?'})${f.inApp ? '' : '  [library]'}`);
        if (f.context) for (const [n, line] of f.context) if (n === f.lineNo) out.push(`      ${String(line).trim()}`);
      }
      out.push('');
    }
  }
  return out.join('\n').trim();
}

async function withSentry<T>(repo: string, cwd: string, mcp: (src: SentrySource, t: ReturnType<typeof sentryTarget>) => Promise<T>, rest: (token: string, t: ReturnType<typeof sentryTarget>) => Promise<T>) {
  const [s, servers] = await Promise.all([load(), userServers(cwd)]);
  const cfg = await configFor(repo, s);
  const t = sentryTarget(cfg);
  const src = sentrySource(servers, s, cfg.sentry);
  const token = sentryToken(s);
  if (!src) throw new Error(`No Sentry MCP server in ~/.claude.json and no token. Set "sentryToken" in ${FILE} or SENTRY_AUTH_TOKEN`);
  try {
    return { via: 'mcp' as const, value: await mcp(src, t), note: undefined as string | undefined };
  } catch (e) {
    if (!token) throw e;
    return { via: 'rest' as const, value: await rest(token, t), note: `Sentry MCP (${src.via}) failed, used the REST API: ${(e as Error).message.split('\n')[0]}` };
  }
}

async function sentryIssues(repo: string, cwd: string): Promise<SentryIssues> {
  const r = await withSentry(
    repo,
    cwd,
    async (src, t) => {
      const out = text(await callTool(keyOf('sentry', src.def), src.def, 'search_issues', { organizationSlug: t.org, projectSlugOrId: t.project, query: 'is:unresolved', sort: 'date', limit: 25 }, 90_000));
      const issues = parseIssues(out, t.base, t.org);
      if (!issues.length && out.trim() && !/no issues|0 issues|no results/i.test(out)) throw new Error(`Could not read the Sentry MCP reply: ${out.slice(0, 300)}`);
      return issues;
    },
    restIssues,
  );
  return { via: r.via, issues: r.value, note: r.note };
}

async function sentryTest(repo: string, cwd: string): Promise<SentryTest> {
  const r = await sentryIssues(repo, cwd);
  return { count: r.issues.length, via: r.via, note: r.note };
}

async function sentryDetails(repo: string, cwd: string, id: string, shortId: string): Promise<SentryDetails> {
  if (!id && !shortId) throw new Error('Missing issue id');
  const r = await withSentry(
    repo,
    cwd,
    async (src, t) => text(await callTool(keyOf('sentry', src.def), src.def, 'get_sentry_resource', { resourceType: 'issue', organizationSlug: t.org, resourceId: shortId || id }, 90_000)),
    (token, t) => restDetails(token, t, id || shortId),
  );
  return { via: r.via, text: r.note ? `${r.note}\n\n${r.value}` : r.value };
}

const SNOWFLAKE_YAML = `other_services:
  object_manager: True
  query_manager: True
  semantic_manager: False
sql_statement_permissions:
  - Select: True
  - Describe: True
  - Show: True
  - Unknown: False
  - Alter: False
  - Command: False
  - Comment: False
  - Commit: False
  - Copy: False
  - Create: False
  - Delete: False
  - Drop: False
  - Insert: False
  - Merge: False
  - Rollback: False
  - Transaction: False
  - TruncateTable: False
  - Update: False
  - Use: False
`;

async function uvx() {
  for (const p of ['/opt/homebrew/bin/uvx', path.join(os.homedir(), '.local/bin/uvx'), '/usr/local/bin/uvx']) if (await access(p).then(() => true, () => false)) return p;
  return 'uvx';
}

async function snowflakeDef(s: Settings): Promise<McpServerDef> {
  const c = { ...EMPTY_SNOWFLAKE, ...s.snowflake };
  if (!c.account || !c.user || !c.secret) throw new Error('Snowflake is not connected: fill in account, user and the token or password in the Snowflake section');
  await mkdir(DIR, { recursive: true });
  await writeFile(YAML, SNOWFLAKE_YAML, { mode: 0o600 });
  const args = ['snowflake-labs-mcp', '--service-config-file', YAML, '--transport', 'stdio', '--account', c.account, '--user', c.user];
  if (c.warehouse) args.push('--warehouse', c.warehouse);
  if (c.role) args.push('--role', c.role);
  if (c.auth === 'pat') args.push('--authenticator', 'PROGRAMMATIC_ACCESS_TOKEN');
  return { type: 'stdio', command: await uvx(), args, env: { SNOWFLAKE_PASSWORD: c.secret } };
}

function readOnlySql(sql: string) {
  const s = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/;\s*$/, '').trim();
  if (!s) throw new Error('Empty query');
  if (s.includes(';')) throw new Error('One statement at a time');
  if (!/^(select|show|desc|describe|with)\b/i.test(s)) throw new Error('Only SELECT, SHOW, DESCRIBE and WITH queries run here');
  return s;
}

function rowsOf(r: McpResult): Record<string, unknown>[] {
  const sc = r.structuredContent as { result?: unknown } | undefined;
  const raw = sc && 'result' in sc ? sc.result : r.structuredContent;
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  const items: Record<string, unknown>[] = [];
  for (const c of r.content ?? []) {
    if (c.type !== 'text' || typeof c.text !== 'string') continue;
    try {
      const v = JSON.parse(c.text);
      if (Array.isArray(v)) items.push(...v);
      else if (v && typeof v === 'object') items.push(v);
    } catch {
      if (!/^no matching/i.test(c.text)) throw new Error(c.text.slice(0, 500));
    }
  }
  return items;
}

async function snowflake(tool: string, args: Record<string, string>) {
  const def = await snowflakeDef(await load());
  const t0 = Date.now();
  const items = rowsOf(await callTool('snowflake', def, tool, args, 120_000));
  return { items, ms: Date.now() - t0 };
}

async function snowflakeQuery(sql: string): Promise<SnowflakeResult> {
  const { items, ms } = await snowflake('run_snowflake_query', { statement: readOnlySql(sql) });
  const columns = [...new Set(items.flatMap((o) => Object.keys(o)))];
  return { columns, rows: items.slice(0, 200).map((o) => columns.map((c) => o[c] ?? null)), truncated: items.length > 200, ms };
}

async function snowflakeTest(): Promise<SnowflakeTest> {
  const { items, ms } = await snowflake('run_snowflake_query', { statement: 'select current_user() as "user", current_role() as "role", current_warehouse() as "warehouse"' });
  return { row: items[0] ?? {}, ms };
}

async function snowflakeObjects(kind: string, database: string, schema: string): Promise<SnowflakeObjects> {
  if (!['database', 'schema', 'table', 'view'].includes(kind)) throw new Error('kind must be database, schema, table or view');
  const args: Record<string, string> = { object_type: kind };
  if (database) args.database_name = database;
  if (schema) args.schema_name = schema;
  const { items } = await snowflake('list_objects', args);
  return { names: items.map((o) => String(o.name ?? o.NAME ?? '')).filter(Boolean) };
}

async function saveSnowflake(input: unknown, cwd: string) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Snowflake settings must be an object');
  const s = await load();
  const prev = { ...EMPTY_SNOWFLAKE, ...s.snowflake };
  const next: SnowflakeConfig = { ...prev };
  const inp = input as Record<string, unknown>;
  for (const k of ['account', 'user', 'warehouse', 'database', 'schema', 'role'] as const) if (typeof inp[k] === 'string') next[k] = (inp[k] as string).trim();
  if (inp.auth === 'pat' || inp.auth === 'password') next.auth = inp.auth;
  if (typeof inp.secret === 'string' && inp.secret) next.secret = inp.secret;
  await save({ ...s, snowflake: next });
  stop('snowflake');
  return info(await repoName(cwd), cwd);
}

async function saveConfig(repo: string, b: Record<string, unknown>, cwd: string) {
  const s = await load();
  const repos = { ...s.repos };
  if ('config' in b) {
    const config = b.config ?? null;
    if (config !== null && (typeof config !== 'object' || Array.isArray(config))) throw new Error('Config must be a JSON object');
    if (config) {
      const c = config as ObserveConfig;
      if (c.sentry?.url) c.sentry.url = httpsUrl(String(c.sentry.url));
      repos[repo] = c;
    }
    else delete repos[repo];
  }
  if (b.sentry && typeof b.sentry === 'object') {
    const inp = b.sentry as Record<string, unknown>;
    const current = repos[repo] ?? (await guess(repo, s));
    const sentry = { ...current.sentry };
    for (const k of ['org', 'project', 'url'] as const) if (typeof inp[k] === 'string') sentry[k] = (inp[k] as string).trim();
    if (sentry.url) sentry.url = httpsUrl(sentry.url);
    repos[repo] = { ...current, sentry };
  }
  const next: Settings = { ...s, repos };
  if (typeof b.sentryToken === 'string') {
    next.sentryToken = b.sentryToken.trim();
    stopAll('sentry:');
  }
  await save(next);
  lokiCache.clear();
  return info(repo, cwd);
}

async function addToClaude(server: string, cwd: string) {
  const [s, servers] = await Promise.all([load(), userServers(cwd)]);
  let def: McpServerDef;
  if (server === 'sentry') {
    const src = sentrySource({}, s, undefined);
    if (!src) throw new Error(`Set "sentryToken" in ${FILE} first`);
    def = src.def;
  } else if (server === 'snowflake') def = await snowflakeDef(s);
  else throw new Error('server must be sentry or snowflake');
  if (servers[server]) throw new Error(`${server} is already in your Claude MCP config`);
  const raw = await readFile(CLAUDE, 'utf8').catch(() => '{}');
  const json = JSON.parse(raw);
  const backup = `${CLAUDE}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
  await copyFile(CLAUDE, backup).catch(() => {});
  json.mcpServers = { ...json.mcpServers, [server]: def };
  await writeFile(CLAUDE, JSON.stringify(json, null, 2) + '\n');
  return { server, file: CLAUDE, backup, info: await info(await repoName(cwd), cwd) };
}

async function body(req: http.IncomingMessage) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error('Request body too large');
  }
  return raw ? JSON.parse(raw) : {};
}

export async function observe(req: http.IncomingMessage, url: URL, cwd: string) {
  const p = url.pathname;
  if (req.method === 'POST') {
    const b = await body(req);
    if (p === '/api/observe/config') {
      if (typeof b.repo !== 'string' || !b.repo.trim()) throw new Error('Missing repo');
      return saveConfig(b.repo.trim(), b, cwd);
    }
    if (p === '/api/observe/snowflake/config') return saveSnowflake(b.snowflake, cwd);
    if (p === '/api/observe/snowflake/test') return snowflakeTest();
    if (p === '/api/observe/snowflake/query') return snowflakeQuery(String(b.sql ?? ''));
    if (p === '/api/observe/mcp/add') return addToClaude(String(b.server ?? ''), cwd);
    throw new Error('Not found');
  }
  const q = (k: string) => url.searchParams.get(k)?.trim() ?? '';
  if (p === '/api/observe/snowflake/objects') return snowflakeObjects(q('kind'), q('database'), q('schema'));
  const repo = q('repo') || (await repoName(cwd));
  if (p === '/api/observe') return info(repo, cwd);
  if (p === '/api/observe/sentry/issues') return sentryIssues(repo, cwd);
  if (p === '/api/observe/sentry/test') return sentryTest(repo, cwd);
  if (p === '/api/observe/sentry/issue') return sentryDetails(repo, cwd, q('id'), q('shortId'));
  if (p.startsWith('/api/observe/grafana/')) {
    const [s, servers] = await Promise.all([load(), userServers(cwd)]);
    const def = grafanaDef(servers);
    const cfg = (await configFor(repo, s)).grafana;
    if (p === '/api/observe/grafana/dashboards') return dashboards(repo, cfg, def);
    if (p === '/api/observe/grafana/logs') return logs(cfg, def);
    if (p === '/api/observe/grafana/patterns') return patterns(cfg, def);
  }
  throw new Error('Not found');
}
