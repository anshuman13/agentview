import { useEffect, useSyncExternalStore } from 'react';
import type { GitStatus } from '../../../shared/protocol';
import { api, useStore } from '../app/store';

let git: { status: GitStatus | null; error: string } = { status: null, error: '' };
const subs = new Set<() => void>();
const subscribe = (l: () => void) => (subs.add(l), () => void subs.delete(l));
export const useGit = () => useSyncExternalStore(subscribe, () => git);

let seq = 0;
export async function refresh() {
  const n = ++seq;
  try {
    const r = await fetch(api('/api/git/status'));
    const d = await r.json().catch(() => null);
    if (n !== seq) return;
    git = r.ok && d ? { status: d, error: '' } : { status: null, error: d?.error ?? `Request failed (${r.status})` };
  } catch {
    return;
  }
  subs.forEach((l) => l());
}

export function ChangesBadge() {
  const n = useGit().status?.files.length ?? 0;
  const id = useStore((s) => s.session.id);
  const recent = useStore((s) => s.recentFiles);
  useEffect(() => void refresh(), [id, recent]);
  return n > 0 ? <span className="badge">{n}</span> : null;
}
