import { hubUrl, tauriInvoke } from '../../codex/data/local';

export async function hubDebug(fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const resp = await fetcher(tauriInvoke() ? `${hubUrl()}/debug` : '/api/assistant/debug', { signal: AbortSignal.timeout(5000) });
    return resp.ok && (await resp.json()).debug === true;
  } catch {
    return false;
  }
}
