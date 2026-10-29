import { useEffect, useMemo, useRef, useState } from 'react';
import { apiUrl } from '../app/api';
import { send } from '../app/store';
import type { ConfirmRequest } from '../ui/Confirm';
import { BIN_MS, type ChatEvent, type LiveChat, type Repo, type RepoKind, type SavedSession, type Worktree } from '../../../shared/protocol';
import { replyLine, sumEdits } from '../../../shared/edits';
import { inside } from '../../../shared/util';

export type Folder = { cwd: string; name: string; repo?: Repo; trees: Worktree[]; chats: SavedSession[]; last: number; hit?: boolean };

// A failed load resolves to null, so the last list stays on screen.
export const get = (url: string) => fetch(apiUrl(url)).then((r) => r.json()).then((x) => (Array.isArray(x) ? x : null)).catch(() => null);

export function buildFolders(repos: Repo[], trees: Worktree[], chats: SavedSession[]) {
  const m = new Map<string, Folder>();
  const folder = (cwd: string, repo?: Repo) => {
    let f = m.get(cwd);
    if (!f) m.set(cwd, (f = { cwd, name: cwd.split('/').pop() || 'Unknown folder', repo, trees: [], chats: [], last: repo?.lastCommit ?? 0 }));
    return f;
  };
  for (const r of repos) folder(r.cwd, r);
  for (const w of trees) folder(w.repo || w.cwd).trees.push(w);
  const dirs = [...m.keys()].sort((a, b) => b.length - a.length);
  for (const c of chats) {
    const tree = trees.find((w) => inside(c.cwd, w.cwd));
    const f = folder(tree ? tree.repo || tree.cwd : dirs.find((d) => inside(c.cwd, d)) ?? c.cwd);
    f.chats.push(c);
    f.last = Math.max(f.last, c.lastModified);
  }
  return [...m.values()].sort((a, b) => b.last - a.last);
}

export const WORKSPACE_MIN_AGE = 30_000;
export type WorkspaceKey = 'repos' | 'chats' | 'trees';
const WORKSPACE_URL: Record<WorkspaceKey, string> = { repos: '/api/repos', chats: '/api/sessions', trees: '/api/worktrees' };

const cached = { repos: [] as Repo[], trees: [] as Worktree[], chats: [] as SavedSession[] };
const fetchedAt: Record<WorkspaceKey, number> = { repos: 0, chats: 0, trees: 0 };

export const staleKeys = (at: Record<WorkspaceKey, number>, now: number, minAge = WORKSPACE_MIN_AGE) =>
  (Object.keys(at) as WorkspaceKey[]).filter((k) => now - at[k] >= minAge);

export const invalidateWorkspace = () => {
  fetchedAt.repos = fetchedAt.chats = fetchedAt.trees = 0;
};

export function useWorkspace(key: unknown) {
  const [repos, setRepos] = useState(cached.repos);
  const [trees, setTrees] = useState(cached.trees);
  const [chats, setChats] = useState(cached.chats);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => void (mounted.current = false);
  }, []);
  useEffect(() => {
    const apply = { repos: setRepos, chats: setChats, trees: setTrees } as Record<WorkspaceKey, (x: never) => void>;
    const now = Date.now();
    setRepos(cached.repos);
    setChats(cached.chats);
    setTrees(cached.trees);
    for (const k of staleKeys(fetchedAt, now)) {
      fetchedAt[k] = now;
      get(WORKSPACE_URL[k]).then((x) => {
        if (!x) return void (fetchedAt[k] = 0);
        (cached as Record<WorkspaceKey, unknown>)[k] = x;
        if (mounted.current) apply[k](x as never);
      });
    }
  }, [key]);
  const folders = useMemo(() => buildFolders(repos, trees, chats), [repos, trees, chats]);
  const edit = <T,>(k: 'trees' | 'chats', set: (f: (l: T[]) => T[]) => void) => (f: (l: T[]) => T[]) =>
    set((l) => ((cached as Record<string, unknown>)[k] = f(l)) as T[]);
  return { folders, chats, setTrees: edit<Worktree>('trees', setTrees), setChats: edit<SavedSession>('chats', setChats) };
}

export function worktreeRequest(d: Folder, track: (branch: string | null, error?: string) => void): ConfirmRequest {
  return {
    title: `New ${d.name} worktree`,
    detail: `Paseo branches off the default branch and runs the repo's setup. A chat opens in the new folder.`,
    action: 'Create',
    icon: 'git-branch-create',
    input: { value: d.repo?.branch.includes('/') ? `${d.repo.branch.split('/')[0]}/` : '', placeholder: 'Branch name' },
    run: async (branch) => {
      track(branch);
      const r = await fetch(apiUrl('/api/worktrees'), { method: 'POST', body: JSON.stringify({ repo: d.cwd, branch }) });
      const body = await r.json().catch(() => null);
      invalidateWorkspace();
      if (r.ok && body?.cwd) send({ type: 'new_session', cwd: body.cwd });
      track(null, r.ok && body?.cwd ? undefined : body?.error ?? 'Could not create the worktree');
    },
  };
}

const WEEK = 7 * 864e5;
export const isDefault = (b?: string) => !b || b === 'main' || b === 'master';

export const KINDS: [RepoKind, string, string][] = [
  ['new', 'New', 'new-folder'], ['web', 'Web apps', 'globe'], ['service', 'Services', 'server'], ['infra', 'Infra', 'layers'], ['data', 'Data', 'database'],
  ['app', 'Apps', 'device-mobile'], ['docs', 'Docs', 'book'], ['other', 'Other', 'repo'],
];
export const segmentOf = (f: Folder) => (f.repo?.root === 'workspace_personal' || f.cwd.includes('/workspace_personal/') ? 'personal' : 'work');

export const isActive = (f: Folder, live: string[], now = Date.now()) =>
  Boolean(f.repo?.dirty) || !isDefault(f.repo?.branch) || f.trees.length > 0 || now - f.last < WEEK ||
  live.some((c) => inside(c, f.cwd) || f.trees.some((w) => inside(c, w.cwd)));

export function groupByKind(folders: Folder[], live: string[], now = Date.now()) {
  return KINDS.map(([kind, label, icon]) => ({
    kind, label, icon,
    items: folders
      .filter((f) => (f.repo?.kind ?? 'other') === kind)
      .map((f) => ({ f, active: isActive(f, live, now) }))
      .sort((x, y) => Number(y.active) - Number(x.active) || x.f.name.localeCompare(y.f.name)),
  })).filter((g) => g.items.length);
}

export const flip = (set: (f: (prev: Set<string>) => Set<string>) => void, key: string) =>
  set((prev) => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

export const closeChat = (c: LiveChat, ask: (r: ConfirmRequest) => void) =>
  c.running || c.pending
    ? ask({ title: 'Close this chat?', detail: c.title, warning: 'Claude is still working on it and will stop. The transcript is kept.', action: 'Close', run: async () => send({ type: 'close', id: c.id }) })
    : send({ type: 'close', id: c.id });

const refreshBin = () => window.dispatchEvent(new Event('agentview:bin'));

export const deleteChat = (s: { sessionId: string; title: string; lastModified: number }, onDone: () => void, onError: (e: string) => void, purge = false): ConfirmRequest => {
  const forever = purge || Date.now() - s.lastModified > BIN_MS;
  return {
    title: forever ? 'Delete this chat?' : 'Move this chat to the bin?',
    detail: s.title,
    warning: forever ? 'The transcript is removed permanently.' : 'You can restore it from the bin for 24 hours.',
    action: 'Delete',
    run: async () => {
      const r = await fetch(apiUrl(`/api/sessions?id=${encodeURIComponent(s.sessionId)}${purge ? '&purge' : ''}`), { method: 'DELETE' });
      if (!r.ok) return onError((await r.json().catch(() => null))?.error ?? 'Could not delete the chat');
      invalidateWorkspace();
      onDone();
      refreshBin();
    },
  };
};

export function findHere(folders: Folder[], cwd: string) {
  const folder = folders.find((f) => inside(cwd, f.cwd) || f.trees.some((w) => inside(cwd, w.cwd)));
  const tree = folder?.trees.find((w) => inside(cwd, w.cwd));
  return { folder, tree, label: tree ? tree.name : folder?.repo?.branch ?? '' };
}

const urgency = (c: LiveChat) => (c.pending ? 0 : c.running ? 1 : 2);
export const byUrgency = (a: LiveChat, b: LiveChat) => urgency(a) - urgency(b) || b.lastActive - a.lastActive;

export type RepoGroup = { key: string; name: string; open: LiveChat[]; recent: SavedSession[]; last: number; running: number; waiting: number };

export function groupByRepo(live: LiveChat[], chats: SavedSession[], folders: Folder[], filter = '') {
  const q = filter.trim().toLowerCase();
  const m = new Map<string, RepoGroup>();
  const add = (cwd: string, title: string, last: number) => {
    const key = findHere(folders, cwd).folder?.cwd ?? cwd;
    const name = key.split('/').pop() || key;
    if (q && !name.toLowerCase().includes(q) && !title.toLowerCase().includes(q)) return null;
    let g = m.get(key);
    if (!g) m.set(key, (g = { key, name, open: [], recent: [], last: 0, running: 0, waiting: 0 }));
    g.last = Math.max(g.last, last);
    return g;
  };
  for (const c of live) {
    const g = add(c.cwd, c.title, c.lastActive);
    if (!g) continue;
    g.open.push(c);
    if (c.running) g.running++;
    if (c.pending) g.waiting++;
  }
  const ids = new Set(live.map((c) => c.sessionId));
  for (const s of chats) if (!ids.has(s.sessionId)) add(s.cwd, s.title, s.lastModified)?.recent.push(s);
  for (const g of m.values()) {
    g.open.sort(byUrgency);
    g.recent.sort((a, b) => b.lastModified - a.lastModified);
  }
  return [...m.values()].sort((a, b) => b.last - a.last);
}

export function chatLine(c: LiveChat, events: ChatEvent[] | null) {
  const done = !c.running && !c.pending;
  const last = c.last ?? (events ? replyLine(events) : undefined);
  const edits = c.edits ?? (events ? sumEdits(events) : undefined);
  return { text: c.pending ? 'Needs you' : c.running ? c.status : last ?? '', edits: done ? edits : undefined, done: done && Boolean(edits) };
}
