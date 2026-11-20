export const QUICK_TIMEOUT = 20000;
export const SYNC_TIMEOUT = 30000;
export const REPLY_TIMEOUT = 120000;
export const LONG_TIMEOUT = 300000;

// The HTTP status of a failed call; 0 when no answer came (network error or timeout).
export class HubError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const RETRY_AFTER = [2000, 5000, 15000];

// The wait before the next retry of a sync that failed because the hub could not be reached, null when the error shows.
export function hubRetry(failures: number, error: unknown): number | null {
  const status = error instanceof HubError ? error.status : -1;
  return [0, 502, 503, 504].includes(status) ? RETRY_AFTER[failures] ?? null : null;
}

export async function hub<T = unknown>(path: string, body?: unknown, timeoutMs = SYNC_TIMEOUT, method?: 'GET' | 'POST'): Promise<T> {
  const init: RequestInit = { method: method ?? (body === undefined ? 'GET' : 'POST'), signal: AbortSignal.timeout(timeoutMs) };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const resp = await fetch(path, init).catch((err) => {
    throw new HubError(err?.message || String(err), 0);
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) throw new HubError(data?.error || `Hub returned HTTP ${resp.status}`, resp.status);
  return data as T;
}
