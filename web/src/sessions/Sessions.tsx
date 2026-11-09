import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { apiUrl } from '../app/api';
import { api, embedded, markSeen, notice, send, setUi, useStore } from '../app/store';
import { Icon } from '../ui/Icon';
import { Chip, IconButton } from '../ui/Button';
import { EmptyState } from '../ui/Panel';
import { Row } from '../ui/Row';
import { Confirm, type ConfirmRequest } from '../ui/Confirm';
import { QuickPick } from '../ui/QuickPick';
import { type LiveChat, type SavedSession, type Worktree } from '../../../shared/protocol';
import { inside } from '../../../shared/util';
import { ago, markSegments, pressable, save, stored } from '../ui/util';
import { queryWords } from '../codex/data/match';
import { Bin } from './Bin';
import { chatOrder, nextUnread, stepChat } from './chatNav';
import { byUrgency, chatFinder, chatsByStatus, chatState, deleteChat, findHere, flip, groupByKind, groupByRepo, groupGlance, holdOrder, invalidateWorkspace, newChatGroups, orderGroups, repoName, segmentOf, usePins, useWorkspace, worktreeRequest, type ChatState, type Folder, type HeldOrder, type RepoGroup } from './folders';
import { RepoRow } from './RepoRow';
import { ChatRow, LiveRow, SavedRow, WaitingRows, chatActions, metaLine, type Actions, type Pin, type SetChats } from './ChatRows';
import { NeedsYou } from './NeedsYou';

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
            title={`${w.name}\n${w.cwd}${w.dirty ? `\n${w.dirty} uncommitted` : ''}${w.merged ? `\nPR #${w.merged} merged` : ''}${w.removable ? '' : '\nOpen, or used in the last 12 hours with no merged PR, so it cannot be removed yet'}`}
          >
            <Icon name="git-branch" small />
            <span className="name">{removing.has(w.id) ? 'Removing… ' : ''}{w.name.split('/').pop()}</span>
            {w.dirty > 0 && <span className="dirty" title={`${w.dirty} uncommitted`}>M</span>}
            {w.merged && <span className="merged" title={`PR #${w.merged} merged`}>Merged</span>}
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
  const cwd = useStore((s) => s.session.cwd);
  const live = useStore((s) => s.live);
  const { folders, chats, setChats } = useWorkspace(current + cwd);
  const savedById = useMemo(() => new Map(chats.map((s) => [s.sessionId, s])), [chats]);
  const [filter, setFilter] = useState('');
  const [status, setStatus] = useState<ChatState | null>(null);
  const hits = useMessageSearch(filter);
  const viewing = useStore((s) => s.session.id);
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
  const seen = useStore((s) => s.seen);
  const unread = useMemo(() => order.filter((id) => {
    const c = live.find((x) => x.id === id);
    const state = c && chatState({ live: c, saved: c.sessionId ? savedById.get(c.sessionId) : undefined }, seen);
    return state === 'done' || state === 'needs';
  }), [order, live, savedById, seen]);
  const nav = useRef({ order, viewing, unread });
  nav.current = { order, viewing, unread };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.shiftKey && (e.code === 'BracketRight' || e.code === 'BracketLeft') && (MAC ? e.metaKey : e.ctrlKey) && !e.altKey) {
        e.preventDefault();
        const id = stepChat(nav.current.order, nav.current.viewing, e.code === 'BracketRight' ? 1 : -1);
        if (id) send({ type: 'view', id });
        return;
      }
      // Slack's ⌥⇧↓ / ⌥⇧↑: the next or previous open chat that is Done or Needs you.
      if (e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        const { unread, viewing } = nav.current;
        const id = nextUnread(unread, viewing, e.key === 'ArrowDown' ? 1 : -1);
        e.preventDefault();
        if (id) send({ type: 'view', id });
        else notice('No unread chats');
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

  const byStatus = status ? chatsByStatus(live, chats, seen, status) : null;
  return (
    <div className="sessions chats">
      <div className="sessions-bar">
        <FilterInput value={filter} set={setFilter} />
        <IconButton icon="add" label="New session in a repo" onClick={() => setUi({ repoPicker: true })} />
      </div>
      <div className="sessions-status">
        {STATUS_CHIPS.map(([v, label]) => <Chip key={v} size="sm" on={status === v} aria-pressed={status === v} onClick={() => setStatus(status === v ? null : v)}>{label}</Chip>)}
        {byStatus && status === 'done' && byStatus.live.length + byStatus.saved.length > 0 && <button className="link sessions-read" onClick={() => [...byStatus.live.map((c) => c.sessionId), ...byStatus.saved.map((s) => s.sessionId)].forEach(markSeen)}>Mark all read</button>}
      </div>
      {byStatus ? <StatusList {...byStatus} row={row} savedRow={savedRow} repo={(cwd) => repoName(folders, cwd)} /> : <>
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
        {!groups.length && !hits.length && <EmptyState size="sm" title={filter ? 'No repo or session matches' : 'No sessions yet'} hint={filter ? undefined : 'Chats you start show here'} />}
        {hits.length > 0 && <div className="group">Messages</div>}
        {hits.map((h) => (
          <Row key={`${h.sessionId}-${h.role}-${h.at}`} title={markSegments(h.text, queryWords(filter)).map((x, i) => (x.hit ? <b key={i}>{x.text}</b> : x.text))} lines={2} meta={messageMeta(h)} onClick={() => send({ type: 'open_session', sessionId: h.sessionId })} />
        ))}
        <Bin ask={setAsk} onRestore={(b) => setChats((l) => [{ sessionId: b.sessionId, title: b.title, cwd: b.cwd, gitBranch: null, lastModified: b.lastModified }, ...l])} />
      </div>
      </>}
      {ask && <Confirm {...ask} onClose={() => setAsk(null)} />}
    </div>
  );
}

const STATUS_CHIPS: [ChatState, string][] = [['running', 'Running'], ['done', 'Unread'], ['failed', 'Failed']];

// The chats in one state across all repos, like the status filter in Claude desktop's sidebar.
function StatusList({ live, saved, row, savedRow, repo }: { live: LiveChat[]; saved: SavedSession[]; row: (c: LiveChat, repo?: string) => ReactNode; savedRow: (s: SavedSession, repo?: string) => ReactNode; repo: (cwd: string) => string }) {
  if (!live.length && !saved.length) return <EmptyState size="sm" title="No chats in this state" />;
  return <div className="tree">{live.map((c) => row(c, repo(c.cwd)))}{saved.map((s) => savedRow(s, repo(s.cwd)))}</div>;
}

function GroupGlance({ g, seen }: { g: RepoGroup; seen: Record<string, number> }) {
  const { running, needs, unread } = groupGlance(g, seen);
  if (needs > 0) return <span className="badge waiting" title={`${needs} need you`}>{needs}</span>;
  if (running > 0) return <span className="badge running" title={`${running} running`}>{running}</span>;
  if (unread > 0) return <span className="badge quiet" title={`${unread} unread`}>{unread}</span>;
  return null;
}

type MessageHit = { sessionId: string; role: 'user' | 'assistant'; text: string; at: string; title: string };

export const messageMeta = (h: Pick<MessageHit, 'title' | 'role' | 'at'>) => metaLine(h.title || 'Untitled', h.role === 'user' ? 'You' : 'Claude', h.at ? ago(h.at) : undefined);

// Prompts and replies of every chat matching the sidebar search, from 3 characters.
function useMessageSearch(filter: string) {
  const [hits, setHits] = useState<MessageHit[]>([]);
  useEffect(() => {
    const q = filter.trim();
    if (q.length < 3) { setHits([]); return; }
    let live = true;
    const t = setTimeout(() => fetch(api(`/api/sessions/search?q=${encodeURIComponent(q)}`)).then((r) => r.json()).then((l) => live && setHits(Array.isArray(l) ? l : []), () => live && setHits([])), 300);
    return () => { live = false; clearTimeout(t); };
  }, [filter]);
  return hits;
}

