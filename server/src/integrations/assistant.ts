import os from 'node:os';

export const HUB = process.env.ASSISTANT_HUB ?? (os.hostname().toLowerCase().startsWith('macmini') ? 'http://localhost:7790' : 'http://macmini.netbird.cloud:7790');

export async function assistantRoute(method: string, url: URL, body: () => Promise<string>): Promise<{ status: number; body: unknown }> {
  const route = url.pathname.slice('/api/assistant'.length);
  let target: string;
  let init: RequestInit = { signal: AbortSignal.timeout(30_000) };
  if (route === '/changes' && method === 'GET') target = `/changes?since=${encodeURIComponent(url.searchParams.get('since') ?? '0')}`;
  else if (route === '/sync' && method === 'POST') {
    target = '/sync';
    init = { ...init, method: 'POST', headers: { 'content-type': 'application/json' }, body: await body() };
  } else return { status: 404, body: { error: 'Not found' } };
  try {
    const resp = await fetch(`${HUB}${target}`, init);
    return { status: resp.status, body: await resp.json().catch(() => ({ error: `Hub returned HTTP ${resp.status}` })) };
  } catch (err) {
    return { status: 502, body: { error: `Assistant hub unreachable: ${err instanceof Error ? err.message : String(err)}` } };
  }
}
