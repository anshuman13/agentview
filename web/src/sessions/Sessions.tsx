import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiUrl } from '../app/api';
import { api, embedded, notice, send, setUi, useStore } from '../app/store';
import { Icon } from '../ui/Icon';
import { Confirm, type ConfirmRequest } from '../ui/Confirm';
import { QuickPick } from '../ui/QuickPick';
import { ATTENTION_LABEL, BIN_MS, type AttentionItem, type BinnedSession, type LiveChat, type SavedSession, type Worktree } from '../../../shared/protocol';
import { inside } from '../../../shared/util';
import { ago, pressable, save, stored, plural } from '../ui/util';
import { PullState, usePullRequests } from '../ops/pulls';
import { byUrgency, chatLine, closeChat, deleteChat, findHere, flip, get, groupByKind, groupByRepo, invalidateWorkspace, isDefault, segmentOf, useWorkspace, worktreeRequest, type Folder, type RepoGroup } from './folders';

const PAGE = 10;

const ROOTS = ['workspace_personal', 'workspace'];

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
    ...(f.repo ? [{ value: f.cwd, label: f.name, detail: `${f.repo.root} · ${f.repo.kind === 'new' ? 'empty' : f.repo.branch || 'no git'}` }] : []),
    ...f.trees.map((w) => ({ value: w.cwd, label: w.name.split('/').pop()!, detail: `${w.project} worktree` })),
  ]);
  return (
    <QuickPick
      title="Start a chat in a folder, or type a name for a new project"
      items={items}
      current={folders.find((f) => f.cwd === cwd || f.trees.some((w) => w.cwd === cwd))?.cwd}
      extra={(q) => (/^[A-Za-z0-9][\w.-]*$/.test(q) && !folders.some((f) => f.name === q) ? ROOTS.map((root) => ({ value: `create:${root}:${q}`, label: `Create ${q}`, detail: `new project in ~/${root}` })) : [])}
      onPick={async (v) => {
        close();
        if (!v.startsWith('create:')) return send({ type: 'new_session', cwd: v });
        const [, root, name] = v.split(':');
        const r = await fetch(apiUrl('/api/folders'), { method: 'POST', body: JSON.stringify({ root, name }) });
        const body = await r.json().catch(() => null);
        if (r.ok && body?.cwd) send({ type: 'new_session', cwd: body.cwd });
        else notice(body?.error ?? 'Could not create the folder');
      }}
      onClose={close}
    />
  );
}

export function Sessions() {
  const current = useStore((s) => s.session.sessionId);
  const cwd = useStore((s) => s.session.cwd);
  const lastSystem = useStore((s) => { const e = s.events[s.events.length - 1]; return e?.kind === 'system' ? e.id : null; });
  const { folders, setTrees, setChats } = useWorkspace(current + cwd);
  const liveKey = useStore((s) => s.live.map((c) => c.cwd).join('\n'));
  const waitingCount = useStore((s) => s.live.reduce((n, c) => n + (c.pending ? 1 : 0), 0));
  const [filter, setFilter] = useState('');
  const viewing = useStore((s) => s.session.id);
  const [segment, setSegment] = useState(() => stored('agentview.workspace.segment', 'work'));
  const [shut, setShut] = useState<string[]>(() => stored('agentview.workspace.kinds', []));
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [full, setFull] = useState<Set<string>>(new Set());
  const [opening, setOpening] = useState<string | null>(null);
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<{ repo: string; branch: string } | null>(null);

  useEffect(() => {
    if (lastSystem) setOpening(null);
  }, [lastSystem]);

  useEffect(() => setOpening(null), [current, cwd]);

  const here = findHere(folders, cwd).folder?.cwd;

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
    invalidateWorkspace();
    send({ type: 'new_session', cwd: dir });
  };

  const call = async (url: string, fallback: string) => {
    const r = await fetch(apiUrl(url), { method: 'DELETE' });
    if (!r.ok) setError((await r.json().catch(() => null))?.error ?? fallback);
    return r.ok;
  };

  const remove = (s: SavedSession) => setAsk(deleteChat(s, () => setChats((l) => l.filter((x) => x.sessionId !== s.sessionId)), setError));

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

  const liveCwds = useMemo(() => (liveKey ? liveKey.split('\n') : []), [liveKey]);
  const counts = { work: shown.filter((f) => segmentOf(f) === 'work').length, personal: shown.filter((f) => segmentOf(f) === 'personal').length };
  const groups = useMemo(() => groupByKind(shown.filter((f) => segmentOf(f) === segment), liveCwds), [shown, segment, liveCwds]);
  const pick = (v: string) => { setSegment(v); save('agentview.workspace.segment', v); };
  const flipKind = (k: string) => { const next = shut.includes(k) ? shut.filter((x) => x !== k) : [...shut, k]; setShut(next); save('agentview.workspace.kinds', next); };
  const isOpen = (d: Folder) => Boolean(d.hit) || (d.cwd === here || liveCwds.some((c) => inside(c, d.cwd))) !== toggled.has(d.cwd);

  const folderRows = (d: Folder, active: boolean, icon: string) => {
    const kids = d.chats.length > 0 || d.trees.length > 0;
    const branch = d.repo && !isDefault(d.repo.branch) ? d.repo.branch : '';
    return (
      <div key={d.cwd}>
        <div className={`row project repo-row ${active ? '' : 'dim'} ${branch ? 'two' : ''} ${d.cwd === here ? 'here' : ''}`} title={d.cwd} {...pressable(() => kids && flip(setToggled, d.cwd))}>
          <span className="twistie">{kids && <Icon name={isOpen(d) ? 'chevron-down' : 'chevron-right'} small />}</span>
          <Icon name={icon} small />
          <span className="label">
            <span className="name">{d.name}</span>
            {branch && <span className="chip sm branch-chip" title={branch}>{branch}</span>}
          </span>
          <span className="badges">
            <span className="dirty" title={d.repo?.dirty ? `${d.repo.dirty} uncommitted` : undefined}>{d.repo?.dirty ? 'M' : ''}</span>
            <span className="count" title={d.chats.length ? plural(d.chats.length, 'chat') : undefined}>{d.chats.length || ''}</span>
            <span className="when">{d.last ? ago(d.last) : ''}</span>
          </span>
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
              <span className="acts">
                <button className="icon-btn" title="Delete chat" onClick={(e) => { e.stopPropagation(); setError(null); remove(s); }}><Icon name="trash" small /></button>
              </span>
            </div>
          ))}
        {isOpen(d) && !filter && d.chats.length > PAGE && (
          <div className="row more" {...pressable(() => flip(setFull, d.cwd))}>
            {full.has(d.cwd) ? 'Show less' : `Show ${d.chats.length - PAGE} more`}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="sessions workspace">
      <div className="sessions-bar">
        <input placeholder="Filter repos and sessions" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setFilter('')} />
        <button className="icon-btn" title="Start a chat in a folder or new project (⌘O)" onClick={() => setUi({ repoPicker: true })}><Icon name="folder-opened" /></button>
        <button className="icon-btn" title="New chat in this folder" onClick={() => start(cwd)}><Icon name="add" /></button>
      </div>
      {error && <div className="hint error" onClick={() => setError(null)}><Icon name="error" small /> {error}</div>}
      <NeedsYou n={waitingCount}>
        <WaitingRows viewing={viewing} ask={setAsk} />
      </NeedsYou>
      <div className="side-switch">
        {(['work', 'personal'] as const).map((k) => (
          <button key={k} className={segment === k ? 'active' : ''} onClick={() => pick(k)}>{k === 'work' ? 'Work' : 'Personal'} <span className="seg-count">{counts[k]}</span></button>
        ))}
      </div>
      <div className="tree">
        {groups.map((g) => (
          <div key={g.kind}>
            <div className="row group-row" {...pressable(() => flipKind(g.kind))}>
              <span className="twistie"><Icon name={filter || !shut.includes(g.kind) ? 'chevron-down' : 'chevron-right'} small /></span>
              <span className="name">{g.label}</span>
              <span className="count">{g.items.length}</span>
            </div>
            {(filter || !shut.includes(g.kind)) && g.items.map(({ f, active }) => folderRows(f, active, g.icon))}
          </div>
        ))}
        {!groups.length && <div className="hint">{filter ? 'No repo or chat matches.' : 'No repos here.'}</div>}
      </div>
      {ask && <Confirm {...ask} onClose={() => setAsk(null)} />}
    </div>
  );
}

const RECENT = 5;
const KEY = 'agentview.chats.collapsed';

export function OpenChats() {
  const current = useStore((s) => s.session.sessionId);
  const viewing = useStore((s) => s.session.id);
  const cwd = useStore((s) => s.session.cwd);
  const live = useStore((s) => s.live);
  const { folders, chats, setChats } = useWorkspace(current + cwd);
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState(() => stored<Record<string, boolean>>(KEY, {}));
  const [full, setFull] = useState<Set<string>>(new Set());
  const [opening, setOpening] = useState<string | null>(null);
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);
  const close = (c: LiveChat) => closeChat(c, setAsk);
  const drop = (id: string) => () => setChats((l) => l.filter((x) => x.sessionId !== id));
  const removeLive = (c: LiveChat) => c.sessionId && setAsk(deleteChat({ sessionId: c.sessionId, title: c.title, lastModified: c.lastActive }, drop(c.sessionId), notice));
  const groups = useMemo(() => groupByRepo(live, chats, folders, filter), [live, chats, folders, filter]);
  const waiting = live.filter((c) => c.pending).sort(byUrgency);
  const isOpen = (g: RepoGroup) => Boolean(filter) || !(collapsed[g.key] ?? !g.open.length);
  const toggle = (g: RepoGroup) => {
    const next = { ...collapsed, [g.key]: isOpen(g) };
    setCollapsed(next);
    save(KEY, next);
  };
  const row = (c: LiveChat, repo?: string) => <LiveRow key={c.id} c={c} repo={repo} selected={c.id === viewing} onClose={() => close(c)} onDelete={() => removeLive(c)} onBeside={c.id === viewing || embedded ? undefined : () => setUi({ beside: c.id })} />;

  useEffect(() => setOpening(null), [current]);
  // A failed or lost open never changes the current chat.
  useEffect(() => {
    if (!opening) return;
    const t = setTimeout(() => setOpening(null), 20_000);
    return () => clearTimeout(t);
  }, [opening]);

  return (
    <div className="sessions chats">
      <div className="sessions-bar">
        <button className="new-chat" onClick={() => setUi({ repoPicker: true })}><Icon name="add" small /> New session in a repo</button>
      </div>
      <div className="sessions-bar">
        <input placeholder="Filter repos and sessions" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setFilter('')} />
      </div>
      <NeedsYou n={waiting.length}>
        {waiting.map((c) => row(c, c.cwd.split('/').pop()))}
      </NeedsYou>
      <div className="tree">
        {groups.map((g) => (
          <div key={g.key}>
            <div className="row project" title={g.key} {...pressable(() => toggle(g))}>
              <span className="twistie"><Icon name={isOpen(g) ? 'chevron-down' : 'chevron-right'} small /></span>
              <span className="name">{g.name}</span>
              <span className="meta">
                {g.running > 0 && <span className="badge running" title={`${g.running} running`}>{g.running}</span>}
                {g.waiting > 0 && <span className="badge waiting" title={`${g.waiting} need you`}>{g.waiting}</span>}
                <span className="count">{g.open.length + g.recent.length}</span>
              </span>
              <span className="acts">
                <button className="icon-btn" title={`New chat in ${g.name}`} onClick={(e) => { e.stopPropagation(); send({ type: 'new_session', cwd: g.key }); }}><Icon name="add" small /></button>
              </span>
            </div>
            {isOpen(g) && g.open.map((c) => row(c))}
            {isOpen(g) && (full.has(g.key) || filter ? g.recent : g.recent.slice(0, RECENT)).map((s) => (
              <div key={s.sessionId} className="row session recent" title={`${s.title}\n${s.cwd}`} {...pressable(() => { setOpening(s.sessionId); send({ type: 'open_session', sessionId: s.sessionId }); })}>
                <span className="name">{opening === s.sessionId ? 'Opening… ' : ''}{s.title}</span>
                <span className="when">{ago(s.lastModified)}</span>
                <span className="acts">
                  <button className="icon-btn" title="Delete chat" onClick={(e) => { e.stopPropagation(); setAsk(deleteChat(s, drop(s.sessionId), notice)); }}><Icon name="trash" small /></button>
                </span>
              </div>
            ))}
            {isOpen(g) && !filter && g.recent.length > RECENT && (
              <div className="row more" {...pressable(() => flip(setFull, g.key))}>
                {full.has(g.key) ? 'Show less' : `Show ${g.recent.length - RECENT} more`}
              </div>
            )}
          </div>
        ))}
        {!groups.length && <div className="hint">{filter ? 'No repo or session matches.' : 'No sessions yet.'}</div>}
        <Bin ask={setAsk} onRestore={(b) => setChats((l) => [{ sessionId: b.sessionId, title: b.title, cwd: b.cwd, gitBranch: null, lastModified: b.lastModified }, ...l])} />
      </div>
      {ask && <Confirm {...ask} onClose={() => setAsk(null)} />}
    </div>
  );
}

function Bin({ ask, onRestore }: { ask: (r: ConfirmRequest) => void; onRestore: (b: BinnedSession) => void }) {
  const [list, setList] = useState<BinnedSession[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const load = () => get('/api/sessions/bin').then((x) => x && setList(x));
    load();
    window.addEventListener('agentview:bin', load);
    return () => window.removeEventListener('agentview:bin', load);
  }, []);
  if (!list.length) return null;
  const restore = async (b: BinnedSession) => {
    const r = await fetch(apiUrl(`/api/sessions/restore?id=${encodeURIComponent(b.sessionId)}`), { method: 'POST' });
    if (!r.ok) return notice('Could not restore the chat');
    setList((l) => l.filter((x) => x.sessionId !== b.sessionId));
    onRestore(b);
  };
  const empty = () => ask({
    title: 'Empty the bin?',
    detail: `${list.length} ${list.length === 1 ? 'chat' : 'chats'}`,
    warning: 'The transcripts are removed permanently.',
    action: 'Empty bin',
    run: async () => {
      const r = await fetch(apiUrl('/api/sessions/bin'), { method: 'DELETE' });
      if (!r.ok) return notice('Could not empty the bin');
      setList([]);
    },
  });
  const left = (b: BinnedSession) => `${Math.max(1, Math.round((b.deletedAt + BIN_MS - Date.now()) / 3600000))}h left`;
  return (
    <div className="bin">
      <div className="row project" {...pressable(() => setOpen((v) => !v))}>
        <span className="twistie"><Icon name={open ? 'chevron-down' : 'chevron-right'} small /></span>
        <Icon name="trash" small />
        <span className="name">Bin</span>
        <span className="meta"><span className="count">{list.length}</span></span>
        <span className="acts">
          <button className="icon-btn" title="Empty bin" onClick={(e) => { e.stopPropagation(); empty(); }}><Icon name="close" small /></button>
        </span>
      </div>
      {open && list.map((b) => (
        <div key={b.sessionId} className="row session recent" title={`${b.title}\n${b.cwd}\nDeleted for good after 24 hours`}>
          <span className="name">{b.title}</span>
          <span className="when">{left(b)}</span>
          <span className="acts">
            <button className="icon-btn" title="Restore chat" onClick={() => restore(b)}><Icon name="discard" small /></button>
            <button className="icon-btn" title="Delete for good" onClick={() => ask(deleteChat(b, () => setList((l) => l.filter((x) => x.sessionId !== b.sessionId)), notice, true))}><Icon name="close" small /></button>
          </span>
        </div>
      ))}
    </div>
  );
}

function WaitingRows({ viewing, ask }: { viewing: string; ask: (r: ConfirmRequest) => void }) {
  const live = useStore((s) => s.live);
  return <>{live.filter((c) => c.pending).map((c) => <LiveRow key={c.id} c={c} repo={c.cwd.split('/').pop()} selected={c.id === viewing} onClose={() => closeChat(c, ask)} />)}</>;
}

function LiveRow({ c, repo, selected, onClose, onDelete, onBeside }: { c: LiveChat; repo?: string; selected: boolean; onClose: () => void; onDelete?: () => void; onBeside?: () => void }) {
  const events = useStore((s) => (s.session.id === c.id ? s.events : null));
  const line = chatLine(c, events);
  const second = Boolean(line.text || line.edits);
  const state = c.pending ? 'Needs you' : c.stalled ? 'No activity for 15 minutes' : c.running ? c.status : 'Idle';
  return (
    <div className={`row session live ${second ? 'two' : ''} ${selected ? 'selected' : ''}`} title={`${c.title}\n${c.cwd}\n${state}`} {...pressable(() => { if (!selected) send({ type: 'view', id: c.id }); })}>
      {line.done ? <span className="mark"><Icon name="pass" small /></span> : <span className={`dot ${c.pending ? 'waiting' : c.stalled ? 'stalled' : c.running ? 'running' : 'idle'}`} />}
      <span className="lines">
        <span className="l1">
          {repo && <span className="repo">{repo}</span>}
          <span className="name">{c.title}</span>
          <span className="when">{c.pending ? 'needs you' : c.stalled ? 'quiet' : c.running ? '' : ago(c.lastActive)}</span>
        </span>
        {second && (
          <span className="l2">
            <span className="sub">{line.text}</span>
            {line.edits && <span className="edits"><span className="add">+{line.edits.add}</span> <span className="del">-{line.edits.del}</span></span>}
          </span>
        )}
      </span>
      <span className="acts">
        {onBeside && <button className="icon-btn desktop-only" title="Open beside the current chat" onClick={(e) => { e.stopPropagation(); onBeside(); }}><Icon name="split-horizontal" small /></button>}
        <button className="icon-btn" title="Close chat, keep the transcript" onClick={(e) => { e.stopPropagation(); onClose(); }}><Icon name="close" small /></button>
        {c.sessionId && onDelete && <button className="icon-btn" title="Delete chat" onClick={(e) => { e.stopPropagation(); onDelete(); }}><Icon name="trash" small /></button>}
      </span>
    </div>
  );
}

const PR_KINDS = new Set<AttentionItem['kind']>(['review', 'ci', 'changes', 'ready', 'stale']);
const ATTENTION_ICON: Record<AttentionItem['kind'], string> = { ci: 'error', changes: 'request-changes', review: 'eye', ready: 'check', issue: 'issues', stale: 'history', commit: 'git-commit', deploy: 'rocket' };

// Chats waiting on the user plus GitHub items the server flagged (failing CI, reviews, assigned issues).
function NeedsYou({ n, children }: { n: number; children: ReactNode }) {
  const items = useStore((s) => s.attention);
  const cwd = useStore((s) => s.session.cwd);
  const live = useStore((s) => s.live);
  const prs = usePullRequests(cwd);
  const [busy, setBusy] = useState<string | null>(null);
  if (n + items.length === 0) return null;
  const pullOf = (it: AttentionItem) => (it.cwd === cwd && PR_KINDS.has(it.kind) ? prs.find((p) => p.number === it.number) : undefined);
  const post = (path: string, id: string) => fetch(api(path), { method: 'POST', body: JSON.stringify({ id }) }).then((r) => r.json());
  const ask = async (it: AttentionItem) => {
    setBusy(it.id);
    try {
      const r = await post('/api/attention/ask', it.id);
      if (r.error) notice(r.error);
      else send({ type: 'view', id: r.id });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="tree needs">
      <div className="group">Needs you <span className="badge waiting">{n + items.length}</span></div>
      {children}
      {items.map((it) => (
        <div key={it.id} className={`row session live two ${busy === it.id ? 'removing' : ''}`} title={`${ATTENTION_LABEL[it.kind]}\n${it.title}\n${it.url}`} {...pressable(() => { const id = it.chatId ?? it.fixing; id ? send({ type: 'view', id }) : window.open(it.url, '_blank'); })}>
          <span className={`state ${it.kind}`}><Icon name={ATTENTION_ICON[it.kind]} small /></span>
          <span className="lines">
            <span className="l1">
              <span className="repo">{it.repo}</span>
              <span className="name">{it.number ? `#${it.number} ` : ''}{it.title}</span>
              <span className="when">{ago(it.since)}</span>
            </span>
            <span className="l2">
              <span className="sub">{ATTENTION_LABEL[it.kind]}</span>
              {pullOf(it) && <PullState pr={pullOf(it)!} />}
              {it.fixing && <span className="sub fixing">Fixing in {live.find((c) => c.id === it.fixing)?.title ?? 'a chat'}</span>}
            </span>
          </span>
          <span className="acts">
            <button className="icon-btn" title="Ask Claude to handle this" onClick={(e) => { e.stopPropagation(); void ask(it); }}><Icon name="sparkle" small /></button>
            <button className="icon-btn" title="Dismiss until it changes" onClick={(e) => { e.stopPropagation(); void post('/api/attention/dismiss', it.id); }}><Icon name="close" small /></button>
          </span>
        </div>
      ))}
    </div>
  );
}

