import { useEffect, useMemo, useState } from 'react';
import { apiBase, apiUrl } from '../app/api';
import { notice, send, useStore } from '../app/store';
import type { ConfirmRequest } from '../ui/Confirm';
import { BIN_MS, type ChatEvent, type LiveChat, type Repo, type RepoKind, type SavedSession, type Worktree } from '../../../shared/protocol';
import { replyLine, sumEdits } from '../../../shared/edits';
import { inside } from '../../../shared/util';
import { advisorOf } from '../../../shared/advisors';
import { profileOfPath } from '../../../shared/workspace';
import { matcher, queryWords } from '../codex/data/ask/match';

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

const WORKSPACE_MIN_AGE = 30_000;
type WorkspaceKey = 'repos' | 'chats' | 'trees';
const WORKSPACE_URL: Record<WorkspaceKey, string> = { repos: '/api/repos', chats: '/api/sessions', trees: '/api/worktrees' };

const cached = { repos: [] as Repo[], trees: [] as Worktree[], chats: [] as SavedSession[] };
const fetchedAt: Record<WorkspaceKey, number> = { repos: 0, chats: 0, trees: 0 };
// The Mac the cache came from; the phone app switches Macs without a reload.
let cachedFor = apiBase();

export const staleKeys = (at: Record<WorkspaceKey, number>, now: number, minAge = WORKSPACE_MIN_AGE) =>
  (Object.keys(at) as WorkspaceKey[]).filter((k) => now - at[k] >= minAge);

export const invalidateWorkspace = () => {
  fetchedAt.repos = fetchedAt.chats = fetchedAt.trees = 0;
};

const listeners = new Set<(k: WorkspaceKey, x: unknown) => void>();

export function useWorkspace(key: unknown) {
  const [repos, setRepos] = useState(cached.repos);
  const [trees, setTrees] = useState(cached.trees);
  const [chats, setChats] = useState(cached.chats);
  useEffect(() => {
    const apply = { repos: setRepos, chats: setChats, trees: setTrees } as Record<WorkspaceKey, (x: never) => void>;
    const on = (k: WorkspaceKey, x: unknown) => apply[k](x as never);
    listeners.add(on);
    return () => void listeners.delete(on);
  }, []);
  useEffect(() => {
    const now = Date.now();
    if (cachedFor !== apiBase()) {
      cachedFor = apiBase();
      Object.assign(cached, { repos: [], trees: [], chats: [] });
      invalidateWorkspace();
    }
    setRepos(cached.repos);
    setChats(cached.chats);
    setTrees(cached.trees);
    for (const k of staleKeys(fetchedAt, now)) {
      fetchedAt[k] = now;
      const from = cachedFor;
      get(WORKSPACE_URL[k]).then((x) => {
        if (from !== cachedFor) return;
        if (!x) return void (fetchedAt[k] = 0);
        (cached as Record<WorkspaceKey, unknown>)[k] = x;
        listeners.forEach((on) => on(k, x));
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
      const r = await fetch(apiUrl('/api/worktrees'), { method: 'POST', body: JSON.stringify({ repo: d.cwd, branch }) }).catch(() => null);
      const body = await r?.json().catch(() => null);
      invalidateWorkspace();
      if (r?.ok && body?.cwd) send({ type: 'new_session', cwd: body.cwd });
      track(null, r?.ok && body?.cwd ? undefined : body?.error ?? 'Could not create the worktree');
    },
  };
}

const WEEK = 7 * 864e5;
export const isDefault = (b?: string) => !b || b === 'main' || b === 'master';

export const KINDS: [RepoKind, string, string][] = [
  ['new', 'New', 'new-folder'], ['web', 'Web apps', 'globe'], ['service', 'Services', 'server'], ['infra', 'Infra', 'layers'], ['data', 'Data', 'database'],
  ['app', 'Apps', 'device-mobile'], ['docs', 'Docs', 'book'], ['other', 'Other', 'repo'],
];
export const segmentOf = (f: Folder) => profileOfPath(f.cwd);

const isActive = (f: Folder, live: string[], now = Date.now()) =>
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
    ? ask({ title: 'Close this chat?', detail: c.title, warning: 'The agent is still working on it and will stop. The transcript is kept.', action: 'Close', run: async () => send({ type: 'close', id: c.id }) })
    : send({ type: 'close', id: c.id });

const refreshBin = () => window.dispatchEvent(new Event('agentview:bin'));

export const removeRequest = (id: string, query: string, onDone: () => void, onError: (e: string) => void) => async () => {
  const r = await fetch(apiUrl(`/api/sessions?id=${encodeURIComponent(id)}${query}`), { method: 'DELETE' }).catch(() => null);
  if (!r?.ok) return onError((await r?.json().catch(() => null))?.error ?? 'Could not delete the chat. It is still in the list.');
  invalidateWorkspace();
  onDone();
  refreshBin();
};

export const deleteChat = (s: { sessionId: string; title: string; lastModified: number }, onDone: () => void, onError: (e: string) => void, purge = false): ConfirmRequest => {
  const forever = purge || Date.now() - s.lastModified > BIN_MS;
  return {
    title: forever ? 'Delete this chat?' : 'Move this chat to the bin?',
    detail: s.title,
    warning: forever ? 'The transcript is removed permanently.' : 'You can restore it from the bin for 24 hours.',
    action: 'Delete',
    run: removeRequest(s.sessionId, purge ? '&purge' : '', onDone, onError),
  };
};

export const archiveChat = (s: { sessionId: string; title: string }, onDone: () => void, onError: (e: string) => void): ConfirmRequest => ({
  title: 'Archive this chat?',
  detail: s.title,
  warning: 'You can restore it from the bin for 24 hours.',
  action: 'Archive',
  run: removeRequest(s.sessionId, '&archive', onDone, onError),
});

export const chatMenuItems = ({ failed, canPin, beside, closable, unread = false }: { failed: boolean; canPin: boolean; beside: boolean; closable: boolean; unread?: boolean }) =>
  [failed && 'retry', canPin && 'pin', unread && 'unread', canPin && 'mute', canPin && 'link', 'rename', beside && 'beside', closable && 'close', 'separator', 'archive'].filter(Boolean) as ('retry' | 'pin' | 'unread' | 'mute' | 'link' | 'rename' | 'beside' | 'close' | 'separator' | 'archive')[];

export const chatSwipe = (pinned: boolean, live?: LiveChat) => ({ right: pinned ? 'unpin' : 'pin', left: live && (live.running || live.pending) ? null : 'archive' }) as const;

export async function restoreChat(id: string) {
  const r = await fetch(apiUrl(`/api/sessions/restore?id=${encodeURIComponent(id)}`), { method: 'POST' }).catch(() => null);
  if (r?.ok) refreshBin();
  return Boolean(r?.ok);
}

export type RenameEvent = 'Enter' | 'Escape' | 'blur';

export function renameTitle(event: RenameEvent, text: string, current: string) {
  const title = text.trim();
  return event !== 'Escape' && title && title !== current ? title : undefined;
}

export async function renameChat(sessionId: string, title: string) {
  const r = await fetch(apiUrl(`/api/sessions/rename?id=${encodeURIComponent(sessionId)}`), { method: 'POST', body: JSON.stringify({ title }) }).catch(() => null);
  if (!r?.ok) notice('Could not rename the chat. The old title is kept.');
  else invalidateWorkspace();
  return Boolean(r?.ok);
}

export function findHere(folders: Folder[], cwd: string) {
  const folder = folders.find((f) => inside(cwd, f.cwd) || f.trees.some((w) => inside(cwd, w.cwd)));
  const tree = folder?.trees.find((w) => inside(cwd, w.cwd));
  return { folder, tree, label: tree ? tree.name : folder?.repo?.branch ?? '' };
}

const urgency = (c: LiveChat) => (c.pending ? 0 : c.running ? 1 : 2);
export const byUrgency = (a: LiveChat, b: LiveChat) => urgency(a) - urgency(b) || b.lastActive - a.lastActive;

export const PINS_URL = '/api/sessions/pins';

// Pins live on the Mac, so every device reads the same list; it reloads whenever the stream reconnects.
export function usePins() {
  const connected = useStore((s) => s.ui.connected);
  const [pins, setPins] = useState<string[]>([]);
  const load = () => get(PINS_URL).then((x) => x && setPins(x));
  useEffect(() => void load(), [connected]);
  const setPin = async (id: string, on: boolean) => {
    const r = await fetch(apiUrl(`${PINS_URL}?id=${encodeURIComponent(id)}`), { method: on ? 'POST' : 'DELETE' }).catch(() => null);
    if (r?.ok) await load();
    else notice(on ? 'Could not pin the chat. Try again.' : 'Could not unpin the chat. Try again.');
    return Boolean(r?.ok);
  };
  return { pins, setPin };
}

export type RepoGroup = { key: string; name: string; open: LiveChat[]; recent: SavedSession[]; last: number; running: number; waiting: number };

export const repoName = (folders: Folder[], cwd: string) => {
  const key = findHere(folders, cwd).folder?.cwd ?? cwd;
  return key.split('/').pop() || key;
};

// A chat matches when every word of the query is in its title, repo or extra texts, or in the title or first prompt of its saved copy.
export function chatFinder(filter: string, chats: SavedSession[]) {
  const words = queryWords(filter);
  const match = matcher(words);
  const saved = new Map(chats.map((s) => [s.sessionId, s]));
  return {
    active: words.length > 0,
    match: (title: string, sessionId: string | null | undefined, ...texts: (string | null | undefined)[]) => {
      const s = sessionId ? saved.get(sessionId) : undefined;
      return match(title, s?.title, s?.firstPrompt, ...texts);
    },
  };
}

export function groupByRepo(live: LiveChat[], chats: SavedSession[], folders: Folder[], filter = '', pinned: ReadonlySet<string> = new Set()) {
  const find = chatFinder(filter, chats);
  const m = new Map<string, RepoGroup>();
  const add = (cwd: string, title: string, sessionId: string | null, last: number) => {
    // Advisor chats show on the Advisors page; a search still finds them here.
    if (!find.active && advisorOf(cwd)) return null;
    const key = findHere(folders, cwd).folder?.cwd ?? cwd;
    const name = repoName(folders, cwd);
    if (find.active && !find.match(title, sessionId, name)) return null;
    let g = m.get(key);
    if (!g) m.set(key, (g = { key, name, open: [], recent: [], last: 0, running: 0, waiting: 0 }));
    g.last = Math.max(g.last, last);
    return g;
  };
  for (const c of live) {
    if (c.sessionId && pinned.has(c.sessionId)) continue;
    const g = add(c.cwd, c.title, c.sessionId, c.lastActive);
    if (!g) continue;
    g.open.push(c);
    if (c.running) g.running++;
    if (c.pending) g.waiting++;
  }
  const ids = new Set(live.map((c) => c.sessionId));
  for (const s of chats) if (!ids.has(s.sessionId) && !pinned.has(s.sessionId)) add(s.cwd, s.title, s.sessionId, s.lastModified)?.recent.push(s);
  for (const g of m.values()) {
    g.open.sort(byUrgency);
    g.recent.sort((a, b) => b.lastModified - a.lastModified);
  }
  return [...m.values()].sort((a, b) => b.last - a.last);
}

// Needs you groups first, then the rest; a frozen key list keeps the rest in that order, with groups missing from it first.
export function orderGroups(groups: RepoGroup[], frozen: readonly string[] | null = null) {
  const slot = new Map((frozen ?? []).map((k, i) => [k, i]));
  const rank = (g: RepoGroup) => (frozen ? slot.get(g.key) ?? -1 : 0);
  return [...groups].sort((a, b) => Number(b.waiting > 0) - Number(a.waiting > 0) || (a.waiting > 0 ? 0 : rank(a) - rank(b)) || b.last - a.last);
}

export type HeldOrder = { id: string; keys: string[]; loaded: boolean } | null;

// The group order taken when a chat opens, retaken once the saved chats load so their repos do not all count as new.
export function holdOrder(prev: HeldOrder, viewing: string, open: boolean, groups: RepoGroup[], loaded: boolean): HeldOrder {
  if (!viewing || !open) return null;
  if (prev?.id === viewing && prev.keys.length && prev.loaded === loaded) return prev;
  return { id: viewing, keys: orderGroups(groups).map((g) => g.key), loaded };
}

export type ChatState = 'needs' | 'failed' | 'running' | 'done';

// Needs you, Failed and Running come from the live chat; Done is activity newer than the last time the chat was opened.
export function chatState({ live, saved }: { live?: LiveChat; saved?: SavedSession }, seen: Record<string, number>): ChatState | null {
  if (live?.pending) return 'needs';
  if (live?.failed) return 'failed';
  if (live?.running) return live.stalled ? null : 'running';
  const id = live?.sessionId ?? saved?.sessionId;
  const at = Math.max(live?.lastActive ?? 0, saved?.lastModified ?? 0);
  return id && seen[id] !== undefined && at > seen[id] ? 'done' : null;
}

// Chats in one state for the sidebar's status chips: open chats first, then saved ones that are not open.
export function chatsByStatus(live: LiveChat[], saved: SavedSession[], seen: Record<string, number>, status: ChatState) {
  const bySession = new Map(saved.map((s) => [s.sessionId, s]));
  const open = new Set(live.map((c) => c.sessionId));
  return {
    live: live.filter((c) => chatState({ live: c, saved: bySession.get(c.sessionId ?? '') }, seen) === status),
    saved: saved.filter((s) => !open.has(s.sessionId) && chatState({ saved: s }, seen) === status),
  };
}

export function groupGlance(g: RepoGroup, seen: Record<string, number>) {
  const n = { running: 0, needs: 0, unread: 0 };
  const count = (state: ChatState | null) => {
    if (state === 'running') n.running++;
    else if (state === 'needs') n.needs++;
    else if (state === 'done') n.unread++;
  };
  for (const c of g.open) count(chatState({ live: c }, seen));
  for (const s of g.recent) count(chatState({ saved: s }, seen));
  return { ...n, last: g.last };
}

// Group keys that gained a live chat the previous list did not have; a chat that only moved between groups is not new.
export const newChatGroups = (prev: ReadonlySet<string> | null, live: [id: string, group: string][]) =>
  prev ? [...new Set(live.filter(([id]) => !prev.has(id)).map(([, key]) => key))] : [];

export const unreadCount = (live: LiveChat[], viewing: string, seen: Record<string, number>, attention: number) =>
  live.filter((c) => c.id !== viewing && ['done', 'needs'].includes(chatState({ live: c }, seen) ?? '')).length + attention;

export function since(t: number, now = Date.now()) {
  const m = Math.max(0, Math.floor((now - t) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.floor(m / 60)} h ago`;
  const day = (x: number) => new Date(x).setHours(0, 0, 0, 0);
  const d = Math.round((day(now) - day(t)) / 864e5);
  return d === 1 ? 'yesterday' : d < 7 ? `${d} d ago` : `${Math.floor(d / 7)} w ago`;
}

export function chatLine(c: LiveChat, events: ChatEvent[] | null) {
  const done = !c.running && !c.pending;
  const last = c.last ?? (events ? replyLine(events) : undefined);
  const edits = c.edits ?? (events ? sumEdits(events) : undefined);
  return { text: c.pending ? 'Needs you' : c.running ? c.status : last ?? '', edits: done ? edits : undefined, done: done && Boolean(edits) };
}
