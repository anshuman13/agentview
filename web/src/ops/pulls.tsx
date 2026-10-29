import { useEffect, useSyncExternalStore } from 'react';
import type { CheckState, PullRequest } from '../../../shared/protocol';
import { api, useStore } from '../app/store';
import { Icon } from '../ui/Icon';

type List = { cwd: string; prs: PullRequest[]; error: string; loading: boolean };
let list: List = { cwd: '', prs: [], error: '', loading: false };
const subs = new Set<() => void>();
const setList = (p: Partial<List>) => {
  list = { ...list, ...p };
  subs.forEach((f) => f());
};
const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f));
export const useList = () => useSyncExternalStore(subscribe, () => list);

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function call<T>(path: string, body?: object): Promise<T> {
  const r = await fetch(api(path), body ? { method: 'POST', body: JSON.stringify(body) } : undefined);
  const data = await r.json().catch(() => ({ error: `Request failed (${r.status})` }));
  if (!r.ok || data?.error) throw new Error(data?.error ?? `Request failed (${r.status})`);
  return data;
}

let inflight = '';
let latest = 0;
export async function load(cwd: string, fresh = false) {
  if (!cwd || (inflight === cwd && !fresh)) return;
  inflight = cwd;
  const req = ++latest;
  setList(list.cwd === cwd ? { loading: true } : { cwd, prs: [], error: '', loading: true });
  try {
    const prs = await call<PullRequest[]>(`/api/gh/prs${fresh ? '?fresh=1' : ''}`);
    if (req === latest) setList({ prs, error: '', loading: false });
  } catch (e) {
    if (req === latest) setList({ prs: [], error: message(e), loading: false });
  } finally {
    if (req === latest) inflight = '';
  }
}

const CHECKS: Record<CheckState, [string, string]> = {
  success: ['pass', 'Checks passed'],
  failure: ['error', 'Checks failed'],
  pending: ['circle-filled', 'Checks running'],
  none: ['circle-outline', 'No checks'],
};
const REVIEW: Record<string, [string, string]> = {
  APPROVED: ['Approved', 'st-ok'],
  CHANGES_REQUESTED: ['Changes requested', 'st-warn'],
  REVIEW_REQUIRED: ['Review required', 'st-warn'],
  COMMENTED: ['Commented', ''],
  DISMISSED: ['Dismissed', ''],
  PENDING: ['Pending', 'st-warn'],
};
export const CheckIcon = ({ state }: { state: CheckState }) => (
  <span className={`gh-check ${state}`} title={CHECKS[state][1]}><Icon name={CHECKS[state][0]} small /></span>
);
export const Counts = ({ a, d }: { a: number; d: number }) => <span className="gh-counts"><span className="add">+{a}</span> <span className="del">-{d}</span></span>;
export const StateChip = ({ state }: { state: string }) => {
  const r = REVIEW[state];
  return r ? <span className={`chip pill sm ${r[1] || 'outline'}`}>{r[0]}</span> : null;
};

// The cached PR list of a repo, loaded once per cwd, for rows outside this pane.
export function usePullRequests(cwd: string) {
  const l = useList();
  useEffect(() => { if (cwd && l.cwd !== cwd) void load(cwd); }, [cwd]);
  return l.cwd === cwd ? l.prs : [];
}

export const PullState = ({ pr }: { pr: PullRequest }) => (
  <span className="gh-state"><CheckIcon state={pr.checks} />{pr.draft ? <span className="chip outline pill sm">Draft</span> : <StateChip state={pr.review} />}<Counts a={pr.additions} d={pr.deletions} /></span>
);

let viewOpen = false;
export const setViewOpen = (v: boolean) => { viewOpen = v; };

export function GitHubBadge() {
  const cwd = useStore((s) => s.session.cwd);
  const { prs } = useList();
  useEffect(() => {
    void load(cwd);
    const t = setInterval(() => !document.hidden && load(cwd, viewOpen), 5 * 60_000);
    return () => clearInterval(t);
  }, [cwd]);
  const n = prs.filter((p) => p.reviewRequested).length;
  return n > 0 ? <span className="badge">{n}</span> : null;
}
