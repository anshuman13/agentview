import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { errText } from '../../../shared/util.js';

export const HUB = process.env.ASSISTANT_HUB ?? (existsSync(path.join(os.homedir(), '.agentview/assistant/assistant.db')) ? 'http://localhost:7790' : 'http://macmini.netbird.cloud:7790');

type Param = { name: string; mode: 'always'; fallback: string } | { name: string; mode: 'flag' | 'positive' };
type Route = { timeout: number; body?: boolean; params?: Param[] | 'all' };

const always = (name: string, fallback = ''): Param => ({ name, mode: 'always', fallback });
const flag = (name: string): Param => ({ name, mode: 'flag' });

const ROUTES: Record<string, Route> = {
  'GET /changes': { timeout: 30_000, params: [always('since', '0'), flag('full')] },
  'GET /transcripts/search': { timeout: 30_000, params: 'all' },
  'GET /transcript': { timeout: 30_000, params: 'all' },
  'GET /debug': { timeout: 30_000 },
  'GET /autopilot': { timeout: 30_000 },
  'GET /history': { timeout: 30_000, params: [always('who')] },
  'POST /sync': { timeout: 30_000, body: true },
  'POST /parse': { timeout: 30_000, body: true },
  'POST /autopilot': { timeout: 30_000, body: true },
  'POST /calendar/block': { timeout: 120_000, body: true },
  'POST /transcripts': { timeout: 300_000, body: true },
  'POST /slack/reply': { timeout: 120_000, body: true, params: [always('id'), flag('edited')] },
  'POST /slack/skip': { timeout: 30_000, params: [always('id')] },
  'POST /slack/summary': { timeout: 300_000 },
  'POST /scan': { timeout: 300_000, params: [always('name')] },
  'POST /calendar': { timeout: 300_000, params: [{ name: 'fresh', mode: 'positive' }] },
};

function query(params: Param[], search: URLSearchParams): string {
  const pairs: string[] = [];
  for (const p of params) {
    const value = search.get(p.name);
    if (p.mode === 'always') pairs.push(`${p.name}=${encodeURIComponent(value ?? p.fallback)}`);
    else if (p.mode === 'flag') {
      if (value === '1') pairs.push(`${p.name}=1`);
    } else if (Number.isFinite(Number(value)) && Number(value) > 0) pairs.push(`${p.name}=${Number(value)}`);
  }
  return pairs.length ? `?${pairs.join('&')}` : '';
}

// The hub's JSON goes through as text: a sync page of a thousand rows is not parsed and serialised again here.
export async function assistantRoute(method: string, url: URL, body: () => Promise<string>): Promise<{ status: number; text: string }> {
  const route = url.pathname.slice('/api/assistant'.length);
  const key = `${method} ${route}`;
  const entry = Object.hasOwn(ROUTES, key) ? ROUTES[key] : undefined;
  if (!entry) return { status: 404, text: JSON.stringify({ error: 'Not found' }) };
  const target = `${route}${entry.params === 'all' ? url.search : query(entry.params ?? [], url.searchParams)}`;
  const init: RequestInit = { signal: AbortSignal.timeout(entry.timeout) };
  if (method === 'POST') init.method = 'POST';
  if (entry.body) {
    init.headers = { 'content-type': 'application/json' };
    init.body = await body();
  }
  try {
    const resp = await fetch(`${HUB}${target}`, init);
    const text = await resp.text();
    const isJson = /\bjson\b/.test(resp.headers.get('content-type') ?? '') && text.trim().length > 0;
    return { status: resp.status, text: isJson ? text : JSON.stringify({ error: `Hub returned HTTP ${resp.status}` }) };
  } catch (err) {
    return { status: 502, text: JSON.stringify({ error: `Assistant hub unreachable: ${errText(err)}` }) };
  }
}

export type HubRow = { id: string; profile: 'work' | 'personal'; deleted: boolean; updated_at: number } & Record<string, unknown>;
export type HubChange = { table: string; id: string; profile: 'work' | 'personal'; updated_at: number; fields: Record<string, string | number | null> };

const rows = new Map<string, Map<string, HubRow>>();
let since = 0;

let syncing: Promise<void> | null = null;

// The hub's rows by table, pulled since the last call. Calls at the same time share one pull.
export async function hubRows(table: string): Promise<HubRow[]> {
  syncing ??= pull().finally(() => (syncing = null));
  await syncing;
  return [...(rows.get(table)?.values() ?? [])].filter((r) => !r.deleted);
}

const KEPT = new Set(['items', 'meetings', 'actions', 'jobs', 'pages', 'facts']);

export function applyHubChanges(into: Map<string, Map<string, HubRow>>, changes: { table: string; id: string; profile: HubRow['profile']; deleted: boolean; updated_at: number; fields: Record<string, unknown> }[]) {
  for (const c of changes) {
    if (!KEPT.has(c.table)) continue;
    const key = `${c.profile}:${c.id}`;
    if (c.deleted) into.get(c.table)?.delete(key);
    else {
      if (!into.has(c.table)) into.set(c.table, new Map());
      into.get(c.table)!.set(key, { ...c.fields, id: c.id, profile: c.profile, deleted: false, updated_at: c.updated_at });
    }
  }
}

async function pull() {
  for (;;) {
    const resp = await fetch(`${HUB}/changes?since=${since}`, { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) throw new Error(`Hub returned HTTP ${resp.status}`);
    const r = (await resp.json()) as { version: number; hasMore: boolean; changes: { table: string; id: string; profile: HubRow['profile']; deleted: boolean; updated_at: number; fields: Record<string, unknown> }[] };
    applyHubChanges(rows, r.changes);
    since = Math.max(since, r.version);
    if (!r.hasMore) break;
  }
}

export async function hubGet<T>(path: string): Promise<T> {
  const resp = await fetch(`${HUB}${path}`, { signal: AbortSignal.timeout(15_000) });
  if (!resp.ok) {
    const body = (await resp.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(typeof body?.error === 'string' ? body.error : `Hub returned HTTP ${resp.status}`);
  }
  return (await resp.json()) as T;
}

export async function hubPush(changes: HubChange[]) {
  const resp = await fetch(`${HUB}/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ since, changes }), signal: AbortSignal.timeout(15_000) });
  if (!resp.ok) throw new Error(`Hub returned HTTP ${resp.status}: ${await resp.text()}`);
}
