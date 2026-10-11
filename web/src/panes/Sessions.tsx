import { useEffect, useMemo, useState } from 'react';
import { notice, send, setUi, useStore } from '../store';
import { Icon } from '../Icon';
import { Confirm, type ConfirmRequest } from '../Confirm';
import { QuickPick } from '../QuickPick';
import { STALE_MS, type LiveChat, type Repo, type SavedSession, type Worktree } from '../../../shared/protocol';

const PAGE = 10;

export type Folder = { cwd: string; name: string; repo?: Repo; trees: Worktree[]; chats: SavedSession[]; last: number; hit?: boolean };

export const inside = (cwd: string, dir: string) => cwd === dir || cwd.startsWith(dir + '/');
const get = (url: string) => fetch(url).then((r) => r.json()).then((x) => (Array.isArray(x) ? x : [])).catch(() => []);

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

const cached = { repos: [] as Repo[], trees: [] as Worktree[], chats: [] as SavedSession[] };

export function useWorkspace(key: unknown) {
  const [repos, setRepos] = useState(cached.repos);
  const [trees, setTrees] = useState(cached.trees);
  const [chats, setChats] = useState(cached.chats);
  useEffect(() => {
    get('/api/repos').then((x) => setRepos((cached.repos = x)));
    get('/api/sessions').then((x) => setChats((cached.chats = x)));
    get('/api/worktrees').then((x) => setTrees((cached.trees = x)));
  }, [key]);
  const folders = useMemo(() => buildFolders(repos, trees, chats), [repos, trees, chats]);
  return { folders, setTrees, setChats };
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
      const r = await fetch('/api/worktrees', { method: 'POST', body: JSON.stringify({ repo: d.cwd, branch }) });
      const body = await r.json().catch(() => null);
      if (r.ok && body?.cwd) send({ type: 'new_session', cwd: body.cwd });
      track(null, r.ok && body?.cwd ? undefined : body?.error ?? 'Could not create the worktree');
    },
  };
}

export function findHere(folders: Folder[], cwd: string) {
  const folder = folders.find((f) => inside(cwd, f.cwd) || f.trees.some((w) => inside(cwd, w.cwd)));
  const tree = folder?.trees.find((w) => inside(cwd, w.cwd));
  return { folder, tree, label: tree ? tree.name : folder?.repo?.branch ?? '' };
}

export function FolderPicker({ onClose }: { onClose: () => void }) {
  const cwd = useStore((s) => s.session.cwd);
  const viewing = useStore((s) => s.session.id);
  const live = useStore((s) => s.live);
  const { folders } = useWorkspace(null);
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);
  const { folder } = findHere(folders, cwd);
  if (ask) return <Confirm {...ask} onClose={onClose} />;

  const state = (c?: LiveChat) => (!c ? 'no chat' : c.pending ? 'needs you' : c.running ? 'working' : 'open chat');
  const dirs = folder ? [{ cwd: folder.cwd, label: folder.name, kind: folder.repo?.branch ?? '' }, ...folder.trees.map((w) => ({ cwd: w.cwd, label: w.name.split('/').pop()!, kind: 'worktree' }))] : [];
  const items = [
    ...dirs.map((d) => {
      const c = live.find((x) => x.cwd === d.cwd);
      return { value: c ? `live:${c.id}` : `dir:${d.cwd}`, label: d.label, detail: [d.kind, state(c)].filter(Boolean).join(' · ') };
    }),
    ...live.filter((c) => !dirs.some((d) => d.cwd === c.cwd)).map((c) => ({ value: `live:${c.id}`, label: c.cwd.split('/').pop()!, detail: `${c.title} · ${state(c)}` })),
    ...(folder?.repo?.paseo ? [{ value: 'new', label: 'New worktree…', detail: `branch off ${folder.name}` }] : []),
  ];
  const pick = (v: string) => {
    if (v === 'new' && folder) return setAsk(worktreeRequest(folder, (_, err) => err && notice(err)));
    if (v.startsWith('live:')) send({ type: 'view', id: v.slice(5) });
    if (v.startsWith('dir:')) send({ type: 'new_session', cwd: v.slice(4) });
    onClose();
  };
  return <QuickPick title="Switch worktree or chat" items={items} current={`live:${viewing}`} onPick={pick} onClose={onClose} />;
}

export function RepoPicker() {
  const cwd = useStore((s) => s.session.cwd);
  const { folders } = useWorkspace(null);
  const close = () => setUi({ repoPicker: false });
  const items = folders.flatMap((f) => [
    ...(f.repo ? [{ value: f.cwd, label: f.name, detail: `${f.repo.root} · ${f.repo.branch}` }] : []),
    ...f.trees.map((w) => ({ value: w.cwd, label: w.name.split('/').pop()!, detail: `${w.project} worktree` })),
  ]);
  return (
    <QuickPick
      title="Start a chat in…"
      items={items}
      current={folders.find((f) => f.cwd === cwd || f.trees.some((w) => w.cwd === cwd))?.cwd}
      onPick={(v) => { send({ type: 'new_session', cwd: v }); close(); }}
      onClose={close}
    />
  );
}

export function Sessions() {
  const current = useStore((s) => s.session.sessionId);
  const viewing = useStore((s) => s.session.id);
  const cwd = useStore((s) => s.session.cwd);
  const live = useStore((s) => s.live);
  const lastEvent = useStore((s) => s.events[s.events.length - 1]);
  const { folders, setTrees, setChats } = useWorkspace(current + cwd);
  const [filter, setFilter] = useState('');
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [full, setFull] = useState<Set<string>>(new Set());
  const [opening, setOpening] = useState<string | null>(null);
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<{ repo: string; branch: string } | null>(null);

  useEffect(() => {
    if (lastEvent?.kind === 'system') setOpening(null);
  }, [lastEvent]);

  useEffect(() => setOpening(null), [current, cwd]);

  const here = folders.find((f) => inside(cwd, f.cwd) || f.trees.some((w) => inside(cwd, w.cwd)))?.cwd;

  const shown = useMemo(() => {
    const f = filter.toLowerCase();
    if (!f) return folders;
    return folders.flatMap((d): Folder[] => {
      if (`${d.name} ${d.repo?.branch ?? ''}`.toLowerCase().includes(f)) return [d];
      const chats = d.chats.filter((s) => `${s.title} ${s.gitBranch ?? ''}`.toLowerCase().includes(f));
      const trees = d.trees.filter((w) => w.name.toLowerCase().includes(f));
      return chats.length || trees.length ? [{ ...d, chats, trees, hit: true }] : [];
    });
  }, [folders, filter]);

  const open = (id: string) => {
    if (id === current) return;
    setOpening(id);
    send({ type: 'open_session', sessionId: id });
  };

  const start = (dir: string) => {
    setError(null);
    send({ type: 'new_session', cwd: dir });
  };

  const call = async (url: string, fallback: string) => {
    const r = await fetch(url, { method: 'DELETE' });
    if (!r.ok) setError((await r.json().catch(() => null))?.error ?? fallback);
    return r.ok;
  };

  const remove = (s: SavedSession) =>
    setAsk({
      title: 'Delete this chat?',
      detail: s.title,
      warning: 'The transcript is removed permanently.',
      action: 'Delete',
      run: async () => {
        if (await call(`/api/sessions?id=${encodeURIComponent(s.sessionId)}`, 'Could not delete the chat')) setChats((l) => l.filter((x) => x.sessionId !== s.sessionId));
      },
    });

  const removeTree = (w: Worktree) =>
    setAsk({
      title: `Remove this ${w.project} worktree?`,
      detail: w.name,
      warning: `${w.dirty ? `${w.dirty} uncommitted ${w.dirty === 1 ? 'change' : 'changes'} will be lost. ` : ''}The folder is deleted, the branch is kept.`,
      action: 'Remove',
      run: async () => {
        flip(setRemoving, w.id);
        if (await call(`/api/worktrees?id=${encodeURIComponent(w.id)}`, 'Could not remove the worktree')) setTrees((t) => t.filter((x) => x.id !== w.id));
        flip(setRemoving, w.id);
      },
    });

  const newTree = (d: Folder) =>
    setAsk(worktreeRequest(d, (branch, err) => {
      setError(err ?? null);
      setCreating(branch ? { repo: d.cwd, branch } : null);
    }));

  const flip = (set: (f: (prev: Set<string>) => Set<string>) => void, key: string) =>
    set((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  const isOpen = (d: Folder) => Boolean(d.hit) || (d.cwd === here) !== toggled.has(d.cwd);

  return (
    <div className="sessions">
      <div className="sessions-bar">
        <input placeholder="Filter repos and chats" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className="icon-btn" title="Start a chat in a repo (⌘O)" onClick={() => setUi({ repoPicker: true })}><Icon name="folder-opened" /></button>
        <button className="icon-btn" title="New chat in this folder" onClick={() => start(cwd)}><Icon name="add" /></button>
      </div>
      {error && <div className="hint error" onClick={() => setError(null)}><Icon name="error" small /> {error}</div>}
      <div className="tree">
        {live.length > 1 && !filter && (
          <>
            <div className="group">Open chats</div>
            {live.map((c) => <LiveRow key={c.id} c={c} selected={c.id === viewing} />)}
            <div className="group">Repos</div>
          </>
        )}
        {shown.map((d) => (
          <div key={d.cwd}>
            <div className={`row project ${d.cwd === here ? 'here' : ''}`} title={d.cwd} onClick={() => flip(setToggled, d.cwd)}>
              <span className="twistie"><Icon name={isOpen(d) ? 'chevron-down' : 'chevron-right'} small /></span>
              <span className="name">{d.name}</span>
              {d.repo && <span className="branch">{d.repo.branch}</span>}
              {d.repo?.dirty ? <span className="dirty" title={`${d.repo.dirty} uncommitted`}>M</span> : null}
              <span className="count">{d.chats.length || ''}</span>
              <span className="acts">
                {d.repo?.paseo && (
                  <button className="icon-btn" title="New worktree" disabled={Boolean(creating)} onClick={(e) => { e.stopPropagation(); newTree(d); }}><Icon name="git-branch-create" small /></button>
                )}
                <button className="icon-btn" title={`New chat in ${d.name}`} onClick={(e) => { e.stopPropagation(); start(d.cwd); }}><Icon name="add" small /></button>
              </span>
            </div>
            {creating?.repo === d.cwd && (
              <div className="row session worktree removing" title={creating.branch}>
                <Icon name="git-branch" small />
                <span className="name">Creating {creating.branch}…</span>
                <span className="busy"><Icon name="loading" small spin /></span>
              </div>
            )}
            {isOpen(d) && d.trees.map((w) => (
              <div
                key={w.id}
                className={`row session worktree ${removing.has(w.id) ? 'removing' : ''}`}
                title={`${w.name}\n${w.cwd}${w.dirty ? `\n${w.dirty} uncommitted` : ''}${w.removable ? '' : '\nUsed in the last 12 hours or open, so it cannot be removed yet'}`}
              >
                <Icon name="git-branch" small />
                <span className="name">{removing.has(w.id) ? 'Removing… ' : ''}{w.name.split('/').pop()}</span>
                {w.dirty > 0 && <span className="dirty" title={`${w.dirty} uncommitted`}>M</span>}
                <span className="when">{ago(w.lastActive)}</span>
                {removing.has(w.id) ? (
                  <span className="busy"><Icon name="loading" small spin /></span>
                ) : (
                  <span className="acts">
                    <button className="icon-btn" title="New chat in this worktree" onClick={() => start(w.cwd)}><Icon name="add" small /></button>
                    {w.removable && (
                      <button className="icon-btn" title="Remove worktree, keep the branch" onClick={() => { setError(null); removeTree(w); }}><Icon name="trash" small /></button>
                    )}
                  </span>
                )}
              </div>
            ))}
            {isOpen(d) &&
              (full.has(d.cwd) || filter ? d.chats : d.chats.slice(0, PAGE)).map((s) => (
                <div
                  key={s.sessionId}
                  className={`row session ${s.sessionId === current ? 'selected' : ''}`}
                  title={`${s.title}\n${s.cwd}${s.gitBranch ? `\n${s.gitBranch}` : ''}`}
                  onClick={() => open(s.sessionId)}
                >
                  <span className="name">{opening === s.sessionId ? 'Opening… ' : ''}{s.title}</span>
                  <span className="when">{ago(s.lastModified)}</span>
                  {s.sessionId !== current && Date.now() - s.lastModified > STALE_MS && (
                    <span className="acts">
                      <button className="icon-btn" title="Delete chat" onClick={(e) => { e.stopPropagation(); setError(null); remove(s); }}><Icon name="trash" small /></button>
                    </span>
                  )}
                </div>
              ))}
            {isOpen(d) && !filter && d.chats.length > PAGE && (
              <div className="row more" onClick={() => flip(setFull, d.cwd)}>
                {full.has(d.cwd) ? 'Show less' : `Show ${d.chats.length - PAGE} more`}
              </div>
            )}
          </div>
        ))}
      </div>
      {ask && <Confirm {...ask} onClose={() => setAsk(null)} />}
    </div>
  );
}

function LiveRow({ c, selected }: { c: LiveChat; selected: boolean }) {
  const state = c.pending ? 'Needs you' : c.running ? c.status : 'Idle';
  return (
    <div className={`row session live ${selected ? 'selected' : ''}`} title={`${c.title}\n${c.cwd}\n${state}`} onClick={() => selected || send({ type: 'view', id: c.id })}>
      <span className={`state ${c.pending ? 'waiting' : c.running ? 'running' : ''}`}>
        <Icon name={c.pending ? 'bell-dot' : c.running ? 'loading' : 'circle-small'} small spin={!c.pending && c.running} />
      </span>
      <span className="repo">{c.cwd.split('/').pop()}</span>
      <span className="name">{c.title}</span>
      <span className="when">{c.pending ? 'needs you' : c.running ? '' : ago(c.lastActive)}</span>
    </div>
  );
}

function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 60) return `${m}m`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
}
