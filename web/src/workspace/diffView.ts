// The Changes panel's ⋯ menu: which diffs are unfolded, and whether whitespace-only changes are hidden.
export const toggled = (open: ReadonlySet<string>, path: string) => {
  const next = new Set(open);
  if (next.has(path)) next.delete(path); else next.add(path);
  return next;
};

export const diffPath = (route: 'branch' | 'show', params: Record<string, string | undefined>, hideWs: boolean) => {
  const q = Object.entries({ ...params, ws: hideWs ? '0' : undefined }).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`);
  return `/api/git/${route}${q.length ? `?${q.join('&')}` : ''}`;
};

export const HIDE_WS_KEY = 'agentview.hideWhitespace';

// All changes is the branch against its base; Uncommitted changes is the working tree against HEAD.
export type DiffScope = 'all' | 'uncommitted';
export const SCOPE_KEY = 'agentview.diffScope';
