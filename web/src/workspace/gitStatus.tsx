import { useEffect } from 'react';
import type { GitStatus } from '../../../shared/protocol';
import { api, useStore } from '../app/store';
import { createStore } from '../ui/createStore';

const git = createStore<{ status: GitStatus | null; error: string }>({ status: null, error: '' });
export const useGit = () => git.use();

let seq = 0;
export async function refresh() {
  const n = ++seq;
  try {
    const r = await fetch(api('/api/git/status'));
    const d = await r.json().catch(() => null);
    if (n !== seq) return;
    git.set(r.ok && d ? { status: d, error: '' } : { status: null, error: d?.error ?? `Request failed (${r.status})` });
  } catch {}
}

export function ChangesBadge() {
  const n = useGit().status?.files.length ?? 0;
  const id = useStore((s) => s.session.id);
  const recent = useStore((s) => s.recentFiles);
  useEffect(() => void refresh(), [id, recent]);
  return n > 0 ? <span className="badge">{n}</span> : null;
}
