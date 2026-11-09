import { errText } from '../../../shared/util.js';
import { callTool, data, listTools, text, type McpServerDef } from './mcpClient.js';
import type { GrafanaDashboards, GrafanaLogs, GrafanaPanel, GrafanaPanels, GrafanaPatterns, LogPattern, ObserveConfig } from '../../../shared/observe.js';
import { seriesPoints } from './promSeries.js';
import type { Servers } from './observeSettings.js';

// One client per server definition, so a repo's grafana is never reused for another repo's.
const keyOf = (name: string, def: McpServerDef) => `${name}:${JSON.stringify(def)}`;
export function grafanaDef(servers: Servers) {
  const def = servers.grafana;
  if (!def) throw new Error('No grafana MCP server in ~/.claude.json. Add one with: claude mcp add grafana -s user -e GRAFANA_URL=... -e GRAFANA_API_KEY=... -- mcp-grafana');
  return def;
}

const grafanaBase = (def: McpServerDef, cfg: ObserveConfig['grafana']) => (cfg?.url || def.env?.GRAFANA_URL || '').replace(/\/$/, '');
const RANGE = { startRfc3339: 'now-1h', endRfc3339: 'now' };
const ERRORS = '|~ "(?i)(error|exception|traceback|fatal|panic)"';

const lokiCache = new Map<string, string>();
const promCache = new Map<string, string>();

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

async function promUid(def: McpServerDef, cfg: ObserveConfig['grafana']) {
  const key = grafanaBase(def, cfg);
  if (promCache.has(key)) return promCache.get(key)!;
  const r = data(await callTool(keyOf('grafana', def), def, 'list_datasources', { type: 'prometheus' })) as { datasources?: { uid: string }[] } | null;
  const uid = r?.datasources?.[0]?.uid;
  if (!uid) throw new Error('Grafana has no Prometheus datasource');
  promCache.set(key, uid);
  return uid;
}

async function exploreLink(def: McpServerDef, uid: string, expr: string, from = 'now-1h') {
  const args = { resourceType: 'explore', datasourceUid: uid, queries: [{ refId: 'A', expr }], timeRange: { from, to: 'now' } };
  const r = await callTool(keyOf('grafana', def), def, 'generate_deeplink', args).catch(() => null);
  const url = r ? text(r).trim() : '';
  return /^https?:\/\//.test(url) ? url : undefined;
}

function selectorOf(cfg: ObserveConfig['grafana']) {
  const sel = cfg?.lokiSelector?.trim();
  if (!sel || !/^\{.*\}$/.test(sel)) throw new Error('Set grafana.lokiSelector (for example {app="cafe"}) in the settings');
  return sel;
}

const nsToIso = (ts: unknown) => {
  const digits = String(ts ?? '').replace(/\D/g, '');
  return digits ? new Date(Number(BigInt(digits) / 1_000_000n)).toISOString() : '';
};

export async function dashboards(repo: string, cfg: ObserveConfig['grafana'], def: McpServerDef): Promise<GrafanaDashboards> {
  const query = cfg?.query?.trim() || repo;
  const r = data(await callTool(keyOf('grafana', def), def, 'search_dashboards', { query, limit: 20 })) as { dashboards?: Record<string, string>[] } | null;
  const base = grafanaBase(def, cfg);
  const found = (r?.dashboards ?? []).map((d) => ({ uid: d.uid, title: d.title, url: d.url?.startsWith('/') ? base + d.url : d.url, folder: d.folderTitle }));
  const pinned = (cfg?.dashboards ?? []).map((d) => ({ uid: d.uid ?? '', title: d.title, url: d.url }));
  const seen = new Set<string>();
  const all = [...pinned, ...found].filter((d) => d.url && !seen.has(d.url) && seen.add(d.url));
  return { dashboards: all, link: base ? `${base}/dashboards?query=${encodeURIComponent(query)}` : undefined };
}

const PANEL_MS = 20_000;
const PANEL_STEP = 300;
const PANEL_FROM = 'now-6h';

export async function panels(cfg: ObserveConfig['grafana'], def: McpServerDef): Promise<GrafanaPanels> {
  const configured = (cfg?.panels ?? []).filter((p) => p && typeof p.title === 'string' && typeof p.query === 'string' && p.query.trim());
  if (!configured.length) return { panels: [] };
  const uid = await promUid(def, cfg);
  const key = keyOf('grafana', def);
  const one = async (p: { title: string; query: string; unit?: string }): Promise<GrafanaPanel> => {
    const out: GrafanaPanel = { title: p.title, unit: p.unit, points: [], last: null };
    try {
      const args = { datasourceUid: uid, expr: p.query, queryType: 'range', startTime: PANEL_FROM, endTime: 'now', stepSeconds: PANEL_STEP };
      const [r, link] = await Promise.all([callTool(key, def, 'query_prometheus', args, PANEL_MS), exploreLink(def, uid, p.query, PANEL_FROM)]);
      out.link = link;
      out.points = seriesPoints(data(r));
      out.last = out.points.length ? out.points[out.points.length - 1][1] : null;
      if (!out.points.length) out.error = 'No data';
    } catch (e) {
      out.error = errText(e).split('\n')[0].slice(0, 200);
    }
    return out;
  };
  return { panels: await Promise.all(configured.map(one)) };
}

export async function logs(cfg: ObserveConfig['grafana'], def: McpServerDef): Promise<GrafanaLogs> {
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

export async function patterns(cfg: ObserveConfig['grafana'], def: McpServerDef): Promise<GrafanaPatterns> {
  const selector = selectorOf(cfg);
  const uid = await lokiUid(def, cfg);
  const tools = new Set((await listTools(keyOf('grafana', def), def)).map((t) => t.name));
  const link = await exploreLink(def, uid, `${selector} ${ERRORS}`);
  const notes: string[] = [];
  const rank = (rows: LogPattern[]) => rows.sort((a, b) => b.count - a.count).slice(0, 20);
  if (tools.has('query_loki_patterns')) {
    try {
      const rows = collectPatterns(data(await callTool(keyOf('grafana', def), def, 'query_loki_patterns', { datasourceUid: uid, logql: selector, ...RANGE })));
      if (rows.length) return { patterns: rank(rows), source: 'Loki patterns', link };
      notes.push('Loki patterns: none');
    } catch (e) {
      notes.push(`Loki patterns: ${errText(e).split('\n')[0]}`);
    }
  }
  if (tools.has('find_error_pattern_logs')) {
    try {
      const labels = Object.fromEntries([...selector.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]));
      const rows = collectPatterns(data(await callTool(keyOf('grafana', def), def, 'find_error_pattern_logs', { name: `agentview ${selector}`, labels, start: new Date(Date.now() - 3600_000).toISOString() }, 60_000)));
      if (rows.length) return { patterns: rank(rows), source: 'Sift', link };
      notes.push('Sift: none');
    } catch (e) {
      notes.push(`Sift: ${errText(e).split('\n')[0]}`);
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

export function clearGrafanaCaches() {
  lokiCache.clear();
  promCache.clear();
}
