import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { apiUrl } from '../app/api';
import { api, embedded, notice, send, setUi, useStore } from '../app/store';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/Button';
import { EmptyState } from '../ui/Panel';
import { Menu, MenuItem, MenuSeparator } from '../ui/Menu';
import { Row } from '../ui/Row';
import { Confirm, type ConfirmRequest } from '../ui/Confirm';
import { QuickPick } from '../ui/QuickPick';
import { ATTENTION_LABEL, type AttentionItem, type LiveChat, type SavedSession, type Worktree } from '../../../shared/protocol';
import { inside } from '../../../shared/util';
import { ago, pressable, save, stored } from '../ui/util';
import { Bin } from './Bin';
import { AgentsBlock } from './AgentRow';
import { openAgent } from './agents';
import { chatOrder, stepChat } from './chatNav';
import { PullState, usePullRequests } from '../ops/pulls';
import { archiveChat, byUrgency, chatFinder, chatMenuItems, chatSwipe, chatLine, chatState, closeChat, deleteChat, findHere, flip, groupByKind, groupByRepo, groupGlance, holdOrder, invalidateWorkspace, isDefault, newChatGroups, orderGroups, renameChat, renameTitle, removeRequest, repoName, restoreChat, segmentOf, since, usePins, useWorkspace, worktreeRequest, type ChatState, type Folder, type HeldOrder, type RenameEvent, type RepoGroup } from './folders';
import { Badge } from '../ui/Badge';
import { RepoRow } from './RepoRow';
import { Swipe } from '../codex/Swipe';
import { showSnack } from '../codex/view';

const PAGE = 5;
const MAC = /Mac|iPhone|iPad/.test(navigator.platform);

function FilterInput({ value, set }: { value: string; set: (v: string) => void }) {
  return <input placeholder="Search repos and chats" value={value} onChange={(e) => set(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && set('')} />;
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

export function Sessions() {
  const current = useStore((s) => s.session.sessionId);
  const cwd = useStore((s) => s.session.cwd);
  const lastSystem = useStore((s) => { const e = s.events[s.events.length - 1]; return e?.kind === 'system' ? e.id : null; });
  const { folders, chats, setTrees, setChats } = useWorkspace(current + cwd);
  const { pins, setPin } = usePins();
  const liveKey = useStore((s) => s.live.map((c) => c.cwd).join('\n'));
  const waitingCount = useStore((s) => s.live.reduce((n, c) => n + (c.pending ? 1 : 0), 0));
  const [filter, setFilter] = useState('');
  const viewing = useStore((s) => s.session.id);
  useEffect(() => {
    if (pendingAgent?.chat !== viewing) return;
    const { id } = pendingAgent;
    pendingAgent = null;
    setTimeout(() => openAgent(id), 0);
  }, [viewing]);
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
    const find = chatFinder(filter, chats);
    if (!find.active) return folders;
    return folders.flatMap((d): Folder[] => {
      if (find.match(d.name, undefined, d.repo?.branch)) return [d];
      const kept = d.chats.filter((s) => find.match(s.title, s.sessionId, d.name, s.gitBranch));
      const trees = d.trees.filter((w) => find.match(w.name, undefined));
      return kept.length || trees.length ? [{ ...d, chats: kept, trees, hit: true }] : [];
    });
  }, [folders, chats, filter]);

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
    const r = await fetch(apiUrl(url), { method: 'DELETE' }).catch(() => null);
    if (!r?.ok) setError((await r?.json().catch(() => null))?.error ?? fallback);
    return !!r?.ok;
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
    return (
      <div key={d.cwd}>
        <RepoRow d={d} active={active} here={d.cwd === here} open={isOpen(d)} icon={icon} creating={Boolean(creating)} toggle={() => flip(setToggled, d.cwd)} newTree={() => newTree(d)} start={() => start(d.cwd)} />
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
        <FilterInput value={filter} set={setFilter} />
        <button className="icon-btn" title="Start a chat in a folder or new project (⌘O)" onClick={() => setUi({ repoPicker: true })}><Icon name="folder-opened" /></button>
        <button className="icon-btn" title="New chat in this folder" onClick={() => start(cwd)}><Icon name="add" /></button>
      </div>
      {error && <div className="hint error" onClick={() => setError(null)}><Icon name="error" small /> {error}</div>}
      <NeedsYou n={waitingCount}>
        <WaitingRows viewing={viewing} ask={setAsk} pins={pins} setPin={setPin} setChats={setChats} />
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
        {!groups.length && <EmptyState size="sm" title={filter ? 'No repo or chat matches' : 'No repos here'} />}
      </div>
      {ask && <Confirm {...ask} onClose={() => setAsk(null)} />}
    </div>
  );
}

const RECENT = 5;
const KEY = 'agentview.chats.collapsed';
const PEEK_MS = 8000;

export function OpenChats() {
  const current = useStore((s) => s.session.sessionId);
  const viewing = useStore((s) => s.session.id);
  const cwd = useStore((s) => s.session.cwd);
  const live = useStore((s) => s.live);
  const { folders, chats, setChats } = useWorkspace(current + cwd);
  const savedById = useMemo(() => new Map(chats.map((s) => [s.sessionId, s])), [chats]);
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState(() => stored<Record<string, boolean>>(KEY, {}));
  const [full, setFull] = useState<Set<string>>(new Set());
  const [opening, setOpening] = useState<string | null>(null);
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);
  const actions = chatActions(setChats, setAsk);
  const { pins, setPin } = usePins();
  const pinSet = useMemo(() => new Set(pins), [pins]);
  const allGroups = useMemo(() => groupByRepo(live, chats, folders, '', pinSet), [live, chats, folders, pinSet]);
  const snapshot = useRef<HeldOrder>(null);
  snapshot.current = holdOrder(snapshot.current, viewing, live.some((c) => c.id === viewing), allGroups, chats.length > 0);
  const frozen = snapshot.current?.keys ?? null;
  const groups = useMemo(() => orderGroups(groupByRepo(live, chats, folders, filter, pinSet), frozen), [live, chats, folders, filter, pinSet, frozen]);
  const pinnedRows = useMemo(() => {
    const find = chatFinder(filter, chats);
    return pins.flatMap((id) => {
      const c = live.find((x) => x.sessionId === id);
      const s = c ? undefined : chats.find((x) => x.sessionId === id);
      const item = c ? { c, title: c.title, repo: repoName(folders, c.cwd) } : s ? { s, title: s.title, repo: repoName(folders, s.cwd) } : null;
      return item && (!find.active || find.match(item.title, id, item.repo)) ? [item] : [];
    });
  }, [live, chats, folders, filter, pins]);
  const waiting = live.filter((c) => c.pending).sort(byUrgency);
  const order = useMemo(() => {
    const pinned = pins.flatMap((id) => live.filter((c) => c.sessionId === id));
    return chatOrder(waiting, pinned, orderGroups(allGroups, frozen));
  }, [live, pins, allGroups, frozen]);
  const nav = useRef({ order, viewing });
  nav.current = { order, viewing };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.shiftKey && (e.code === 'BracketRight' || e.code === 'BracketLeft') && (MAC ? e.metaKey : e.ctrlKey) && !e.altKey) {
        e.preventDefault();
        const id = stepChat(nav.current.order, nav.current.viewing, e.code === 'BracketRight' ? 1 : -1);
        if (id) send({ type: 'view', id });
        return;
      }
      if ((e.key !== 'j' && e.key !== 'k') || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const at = document.activeElement;
      if (at && at !== document.body) return;
      const visible = (q: string) => document.querySelector<HTMLElement>(q)?.offsetParent != null;
      if (visible('.tasks') || visible('[data-reply-row]')) return;
      const first = document.querySelector<HTMLElement>('.chats [data-chat-row]');
      if (!first) return;
      e.preventDefault();
      first.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const seen = useStore((s) => s.seen);
  const [peeking, setPeeking] = useState<ReadonlySet<string>>(new Set());
  const peekTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const liveIds = useRef<Set<string> | null>(null);
  const isOpen = (g: RepoGroup) => Boolean(filter) || peeking.has(g.key) || !(collapsed[g.key] ?? !g.open.length);
  const unpeek = (key: string) => {
    clearTimeout(peekTimers.current.get(key));
    peekTimers.current.delete(key);
    setPeeking((p) => new Set([...p].filter((k) => k !== key)));
  };
  useEffect(() => {
    const fresh = newChatGroups(liveIds.current, live.map((c) => [c.id, findHere(folders, c.cwd).folder?.cwd ?? c.cwd]));
    if (live.length) liveIds.current = new Set(live.map((c) => c.id));
    for (const key of fresh.filter((k) => collapsed[k])) {
      clearTimeout(peekTimers.current.get(key));
      peekTimers.current.set(key, setTimeout(() => unpeek(key), PEEK_MS));
      setPeeking((p) => new Set(p).add(key));
    }
  }, [live]);
  useEffect(() => () => peekTimers.current.forEach(clearTimeout), []);
  const toggle = (g: RepoGroup) => {
    unpeek(g.key);
    const next = { ...collapsed, [g.key]: isOpen(g) };
    setCollapsed(next);
    save(KEY, next);
  };
  const row = (c: LiveChat, repo?: string) => <LiveRow key={c.id} c={c} saved={savedById.get(c.sessionId ?? '')} repo={repo} branch={findHere(folders, c.cwd).folder?.repo?.branch} selected={c.id === viewing} actions={actions} ask={setAsk} pinned={pins.includes(c.sessionId ?? '')} onPin={(on) => setPin(c.sessionId!, on)} onBeside={c.id === viewing || embedded ? undefined : () => setUi({ beside: c.id })} />;

  const savedRow = (s: SavedSession, repo?: string) => (
    <SavedRow key={s.sessionId} s={s} repo={repo} branch={findHere(folders, s.cwd).folder?.repo?.branch} opening={opening === s.sessionId} pinned={pins.includes(s.sessionId)} onOpen={() => { setOpening(s.sessionId); send({ type: 'open_session', sessionId: s.sessionId }); }} actions={actions} onPin={(on) => setPin(s.sessionId, on)} />
  );

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
        <FilterInput value={filter} set={setFilter} />
        <IconButton icon="add" label="New session in a repo" onClick={() => setUi({ repoPicker: true })} />
      </div>
      <NeedsYou n={waiting.length}>
        {waiting.map((c) => row(c, c.cwd.split('/').pop()))}
      </NeedsYou>
      {pinnedRows.length > 0 && (
        <div className="tree needs">
          <div className="group">Pinned</div>
          {pinnedRows.map((p) => (p.c ? row(p.c, p.repo) : savedRow(p.s!, p.repo)))}
        </div>
      )}
      <div className="tree">
        {groups.map((g) => (
          <div key={g.key}>
            <div className="row project" title={g.key} {...pressable(() => toggle(g))}>
              <span className="twistie"><Icon name={isOpen(g) ? 'chevron-down' : 'chevron-right'} small /></span>
              <span className="name">{g.name}</span>
              <span className="meta"><GroupGlance g={g} seen={seen} /></span>
              <span className="acts">
                <button className="icon-btn" title={`New chat in ${g.name}`} onClick={(e) => { e.stopPropagation(); send({ type: 'new_session', cwd: g.key }); }}><Icon name="add" small /></button>
              </span>
            </div>
            {isOpen(g) && g.open.filter((c) => !c.pending).map((c) => row(c))}
            {isOpen(g) && (full.has(g.key) || filter ? g.recent : g.recent.slice(0, RECENT)).map((s) => savedRow(s))}
            {isOpen(g) && !filter && g.recent.length > RECENT && (
              <div className="row more" {...pressable(() => flip(setFull, g.key))}>
                {full.has(g.key) ? 'Show less' : `Show ${g.recent.length - RECENT} more`}
              </div>
            )}
          </div>
        ))}
        {!groups.length && <EmptyState size="sm" title={filter ? 'No repo or session matches' : 'No sessions yet'} />}
        <Bin ask={setAsk} onRestore={(b) => setChats((l) => [{ sessionId: b.sessionId, title: b.title, cwd: b.cwd, gitBranch: null, lastModified: b.lastModified }, ...l])} />
      </div>
      {ask && <Confirm {...ask} onClose={() => setAsk(null)} />}
    </div>
  );
}

function GroupGlance({ g, seen }: { g: RepoGroup; seen: Record<string, number> }) {
  const { running, needs, unread } = groupGlance(g, seen);
  if (needs > 0) return <span className="badge waiting" title={`${needs} need you`}>{needs}</span>;
  if (running > 0) return <span className="badge running" title={`${running} running`}>{running}</span>;
  if (unread > 0) return <span className="badge quiet" title={`${unread} unread`}>{unread}</span>;
  return null;
}

type SetChats = (f: (l: SavedSession[]) => SavedSession[]) => void;
type Pin = (on: boolean) => Promise<boolean>;
type Actions = {
  rename: (id: string, title: string) => void;
  archive: (s: { sessionId: string; title: string }) => void;
  archiveNow: (s: SavedSession, pinned: boolean, pin: Pin) => void;
};

const chatActions = (setChats: SetChats, ask: (r: ConfirmRequest) => void): Actions => ({
  rename: async (id, title) => {
    if (await renameChat(id, title)) setChats((l) => l.map((x) => (x.sessionId === id ? { ...x, title } : x)));
  },
  archive: (s) => ask(archiveChat(s, () => setChats((l) => l.filter((x) => x.sessionId !== s.sessionId)), notice)),
  archiveNow: (s, pinned, pin) => removeRequest(s.sessionId, '&archive', () => {
    setChats((l) => l.filter((x) => x.sessionId !== s.sessionId));
    showSnack('Archived', async () => {
      if (!(await restoreChat(s.sessionId))) return notice('Could not restore the chat');
      setChats((l) => [s, ...l]);
      if (pinned) await pin(true);
    });
  }, notice)(),
});

function RenameInput({ value, onSave, onCancel }: { value: string; onSave: (title: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(value);
  const done = useRef(false);
  const finish = (event: RenameEvent) => {
    if (done.current) return;
    done.current = true;
    const title = renameTitle(event, text, value);
    if (title) onSave(title);
    else onCancel();
  };
  return (
    <input
      className="chat-rename"
      autoFocus
      maxLength={120}
      aria-label="Chat title"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish('blur')}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish('Enter');
        if (e.key === 'Escape') {
          e.stopPropagation();
          finish('Escape');
        }
      }}
    />
  );
}

type ChatRowProps = {
  sessionId?: string;
  title: string;
  cwd: string;
  lastModified: number;
  live?: LiveChat;
  opening?: boolean;
  meta: ReactNode;
  state: ChatState | null;
  selected?: boolean;
  pinned?: boolean;
  actions: Actions;
  onOpen: () => void;
  onPin?: Pin;
  onBeside?: () => void;
  onClose?: () => void;
};

const BADGE = { needs: 'waiting', failed: 'failed', running: 'running', done: 'done' } as const;

function ChatRow({ sessionId, title, cwd, lastModified, live, opening, meta, state, selected, pinned, actions, onOpen, onPin, onBeside, onClose }: ChatRowProps) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const unread = state === 'done' || state === 'needs';
  useEffect(() => {
    if (!retrying) return;
    if (state !== 'failed') return setRetrying(false);
    const t = setTimeout(() => setRetrying(false), 3000);
    return () => clearTimeout(t);
  }, [retrying, state]);
  const pick = (act: () => void) => () => { setMenu(false); act(); };
  const rowKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const step = e.key === 'j' || e.key === 'ArrowDown' ? 1 : e.key === 'k' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    if (e.key.startsWith('Arrow')) e.preventDefault();
    const rows = [...document.querySelectorAll<HTMLElement>('.chats [data-chat-row]')];
    rows[rows.indexOf(e.currentTarget) + step]?.focus();
  };
  if (renaming) {
    const save = (t: string) => {
      setRenaming(false);
      actions.rename(sessionId!, t);
    };
    return <div className="chat-row"><Row plain title={<RenameInput value={title} onSave={save} onCancel={() => setRenaming(false)} />} /></div>;
  }
  const retry = () => {
    setRetrying(true);
    send({ type: 'view', id: live!.id });
    send({ type: 'retry' }, live!.id);
  };
  const swipe = chatSwipe(!!pinned, live);
  const swipePin = async () => {
    const on = swipe.right === 'pin';
    if (await onPin!(on)) showSnack(on ? 'Pinned' : 'Unpinned', () => void onPin!(!on));
  };
  const row = (
    <div className="chat-row">
      <Row data-chat-row onKeyDown={rowKey} title={`${opening ? 'Opening… ' : ''}${title}`} meta={meta} aria-current={selected || undefined} leading={<span className={`chat-dot ${unread ? 'on' : ''}`} role={unread ? 'img' : undefined} aria-label={unread ? 'Unread' : undefined} />} trailing={state && <Badge status={BADGE[state]} label={state === 'needs' ? 'Needs you' : undefined} />} onClick={onOpen} onDoubleClick={sessionId ? (e) => { if ((e.target as HTMLElement).closest('.ui-row-title')) setRenaming(true); } : undefined} onLongPress={sessionId ? () => setRenaming(true) : undefined} />
      <IconButton ref={more} icon="kebab-vertical" label="More" size="sm" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
      {menu && (
        <Menu trigger={more} onClose={() => setMenu(false)}>
          {chatMenuItems({ failed: state === 'failed' && !!live, canPin: !!sessionId && !!onPin, beside: !!onBeside, closable: !!onClose }).map((key) => {
            switch (key) {
              case 'retry': return <MenuItem key={key} icon="refresh" disabled={retrying} onClick={pick(retry)}>Retry</MenuItem>;
              case 'pin': return <MenuItem key={key} icon={pinned ? 'pinned' : 'pin'} onClick={pick(() => void onPin!(!pinned))}>{pinned ? 'Unpin' : 'Pin'}</MenuItem>;
              case 'rename': return <MenuItem key={key} icon="edit" disabled={!sessionId} onClick={pick(() => setRenaming(true))}>Rename</MenuItem>;
              case 'beside': return <MenuItem key={key} icon="split-horizontal" className="desktop-only" onClick={pick(onBeside!)}>Open beside</MenuItem>;
              case 'close': return <MenuItem key={key} icon="close" onClick={pick(onClose!)}>Close chat</MenuItem>;
              case 'separator': return <MenuSeparator key={key} />;
              case 'archive': return <MenuItem key={key} icon="archive" danger disabled={!sessionId} onClick={pick(() => actions.archive({ sessionId: sessionId!, title }))}>Archive</MenuItem>;
            }
          })}
        </Menu>
      )}
    </div>
  );
  if (!sessionId || !onPin) return row;
  return (
    <Swipe
      rightLabel={swipe.right === 'pin' ? 'Pin' : 'Unpin'}
      rightIcon={swipe.right === 'pin' ? 'pin' : 'pinned'}
      onRight={swipePin}
      leftLabel="Archive"
      leftIcon="archive"
      onLeft={swipe.left ? () => actions.archiveNow({ sessionId, title, cwd, gitBranch: null, lastModified }, !!pinned, onPin) : undefined}
    >
      {row}
    </Swipe>
  );
}

const metaLine = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' · ');

const branchOf = (saved?: string | null, repoBranch?: string) => {
  const b = saved || repoBranch;
  return isDefault(b) ? undefined : b;
};

function SavedRow({ s, repo, branch, opening, pinned, actions, onOpen, onPin }: { s: SavedSession; repo?: string; branch?: string; opening: boolean; pinned: boolean; actions: Actions; onOpen: () => void; onPin: Pin }) {
  const seen = useStore((x) => x.seen);
  return <ChatRow sessionId={s.sessionId} title={s.title} cwd={s.cwd} lastModified={s.lastModified} opening={opening} meta={metaLine(repo, branchOf(s.gitBranch, branch), since(s.lastModified))} state={chatState({ saved: s }, seen)} pinned={pinned} actions={actions} onOpen={onOpen} onPin={onPin} />;
}

function WaitingRows({ viewing, ask, pins, setPin, setChats }: { viewing: string; ask: (r: ConfirmRequest) => void; pins: string[]; setPin: (id: string, on: boolean) => Promise<boolean>; setChats: SetChats }) {
  const live = useStore((s) => s.live);
  const actions = chatActions(setChats, ask);
  return <>{live.filter((c) => c.pending).map((c) => <LiveRow key={c.id} c={c} repo={c.cwd.split('/').pop()} selected={c.id === viewing} actions={actions} ask={ask} pinned={pins.includes(c.sessionId ?? '')} onPin={(on) => setPin(c.sessionId!, on)} />)}</>;
}

function LiveRow({ c, saved, repo, branch, selected, pinned, actions, ask, onPin, onBeside }: { c: LiveChat; saved?: SavedSession; repo?: string; branch?: string; selected: boolean; pinned?: boolean; actions: Actions; ask: (r: ConfirmRequest) => void; onPin?: Pin; onBeside?: () => void }) {
  const events = useStore((s) => (s.session.id === c.id ? s.events : null));
  const seen = useStore((s) => s.seen);
  const line = chatLine(c, events);
  const when = c.pending ? since(c.lastActive) : c.stalled ? 'No activity for 15 min' : c.running ? line.text || 'Working' : since(Math.max(c.lastActive, saved?.lastModified ?? 0));
  const meta = (
    <>
      {metaLine(repo, branchOf(saved?.gitBranch, branch), when)}
      {line.edits && <> · <span className="chat-add">+{line.edits.add}</span> <span className="chat-del">-{line.edits.del}</span></>}
    </>
  );
  return (
    <>
      <ChatRow sessionId={c.sessionId ?? undefined} title={c.title} cwd={c.cwd} lastModified={saved?.lastModified ?? c.lastActive} live={c} meta={meta} state={chatState({ live: c, saved }, seen)} selected={selected} pinned={pinned} actions={actions} onOpen={() => { if (!selected) send({ type: 'view', id: c.id }); }} onPin={onPin} onBeside={onBeside} onClose={() => closeChat(c, ask)} />
      {c.agentList && <LiveAgents c={c} />}
    </>
  );
}

const agentsOpen = new Set<string>();
let pendingAgent: { chat: string; id: string } | null = null;

function LiveAgents({ c }: { c: LiveChat }) {
  const [open, setOpen] = useState(() => agentsOpen.has(c.id));
  const viewing = useStore((s) => s.session.id);
  const toggle = () => {
    if (open) agentsOpen.delete(c.id);
    else agentsOpen.add(c.id);
    setOpen(!open);
  };
  const pick = (id: string) => {
    if (c.id === viewing) return openAgent(id);
    pendingAgent = { chat: c.id, id };
    send({ type: 'view', id: c.id });
  };
  return <AgentsBlock agents={c.agentList!} open={open} onToggle={toggle} onOpen={pick} />;
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
    } catch {
      notice('Could not ask Claude');
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
            <button className="icon-btn" title="Dismiss until it changes" onClick={(e) => { e.stopPropagation(); post('/api/attention/dismiss', it.id).catch(() => notice('Could not dismiss')); }}><Icon name="close" small /></button>
          </span>
        </div>
      ))}
    </div>
  );
}

