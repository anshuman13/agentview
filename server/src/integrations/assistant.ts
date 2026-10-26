import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HUB = process.env.ASSISTANT_HUB ?? (existsSync(path.join(os.homedir(), '.agentview/assistant/assistant.db')) ? 'http://localhost:7790' : 'http://macmini.netbird.cloud:7790');

export async function assistantRoute(method: string, url: URL, body: () => Promise<string>): Promise<{ status: number; body: unknown }> {
  const route = url.pathname.slice('/api/assistant'.length);
  let target: string;
  let init: RequestInit = { signal: AbortSignal.timeout(30_000) };
  if (route === '/changes' && method === 'GET') target = `/changes?since=${encodeURIComponent(url.searchParams.get('since') ?? '0')}`;
  else if (route === '/sync' && method === 'POST') {
    target = '/sync';
    init = { ...init, method: 'POST', headers: { 'content-type': 'application/json' }, body: await body() };
  } else if (route === '/transcripts' && method === 'POST') {
    target = '/transcripts';
    init = { signal: AbortSignal.timeout(300_000), method: 'POST', headers: { 'content-type': 'application/json' }, body: await body() };
  } else if (route === '/calendar' && method === 'POST') {
    const fresh = Number(url.searchParams.get('fresh'));
    target = Number.isFinite(fresh) && fresh > 0 ? `/calendar?fresh=${fresh}` : '/calendar';
    init = { signal: AbortSignal.timeout(300_000), method: 'POST' };
  } else return { status: 404, body: { error: 'Not found' } };
  try {
    const resp = await fetch(`${HUB}${target}`, init);
    return { status: resp.status, body: await resp.json().catch(() => ({ error: `Hub returned HTTP ${resp.status}` })) };
  } catch (err) {
    return { status: 502, body: { error: `Assistant hub unreachable: ${err instanceof Error ? err.message : String(err)}` } };
  }
}

export type HubRow = { id: string; profile: 'work' | 'personal'; deleted: boolean; updated_at: number } & Record<string, unknown>;
export type HubChange = { table: string; id: string; profile: 'work' | 'personal'; updated_at: number; fields: Record<string, string | number | null> };

const rows = new Map<string, Map<string, HubRow>>();
let since = 0;

// The hub's rows by table, pulled since the last call.
export async function hubRows(table: string): Promise<HubRow[]> {
  for (;;) {
    const resp = await fetch(`${HUB}/changes?since=${since}`, { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) throw new Error(`Hub returned HTTP ${resp.status}`);
    const r = (await resp.json()) as { version: number; hasMore: boolean; changes: { table: string; id: string; profile: HubRow['profile']; deleted: boolean; updated_at: number; fields: Record<string, unknown> }[] };
    for (const c of r.changes) {
      if (!rows.has(c.table)) rows.set(c.table, new Map());
      rows.get(c.table)!.set(`${c.profile}:${c.id}`, { ...c.fields, id: c.id, profile: c.profile, deleted: c.deleted, updated_at: c.updated_at });
    }
    since = Math.max(since, r.version);
    if (!r.hasMore) break;
  }
  return [...(rows.get(table)?.values() ?? [])].filter((r) => !r.deleted);
}

export async function hubPush(changes: HubChange[]) {
  const resp = await fetch(`${HUB}/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ since, changes }), signal: AbortSignal.timeout(15_000) });
  if (!resp.ok) throw new Error(`Hub returned HTTP ${resp.status}: ${await resp.text()}`);
}
