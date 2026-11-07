export const QUICK_TIMEOUT = 20000;
export const SYNC_TIMEOUT = 30000;
export const REPLY_TIMEOUT = 120000;
export const LONG_TIMEOUT = 300000;

export async function hub<T = unknown>(path: string, body?: unknown, timeoutMs = SYNC_TIMEOUT, method?: 'GET' | 'POST'): Promise<T> {
  const init: RequestInit = { method: method ?? (body === undefined ? 'GET' : 'POST'), signal: AbortSignal.timeout(timeoutMs) };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const resp = await fetch(path, init);
  const data = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(data?.error || `Hub returned HTTP ${resp.status}`);
  return data as T;
}
