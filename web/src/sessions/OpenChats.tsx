import { useEffect, useMemo, useRef, useState } from 'react';
import { embedded, markSeen, markUnread, notice, send, setUi, useStore } from '../app/store';
import { showSnack } from '../codex/view';
import { Icon } from '../ui/Icon';
import { IconButton, ShowAll } from '../ui/Button';
import { EmptyState } from '../ui/Panel';
import { Row } from '../ui/Row';
import { Confirm, type ConfirmRequest } from '../ui/Confirm';
import type { LiveChat, SavedSession } from '../../../shared/protocol';
import { ago, markSegments, plural, pressable, save, stored } from '../ui/util';
import { queryWords } from '../codex/data/ask/match';
import { Bin } from './Bin';
import { chatOrder, nextUnread, stepChat } from './chatNav';
import { byUrgency, chatFinder, chatState, doneChats, findHere, flip, groupByRepo, groupGlance, holdOrder, newChatGroups, orderGroups, waitingChats, repoName, usePins, useWorkspace, type Folder, type HeldOrder, type RepoGroup } from './folders';
import { FilterInput } from './FilterInput';
import { LiveRow, SavedRow, chatActions, metaLine } from './ChatRows';
import { searchMessages } from './sessionApi';
import { NeedsYou } from './NeedsYou';
import { NewChatSheet } from './NewChatSheet';
import { requestFind, takeFind } from '../chat/transcript/FindBar';
import { MAC } from '../app/shell/keys';

const RECENT = 5;
const KEY = 'agentview.chats.collapsed';
const PEEK_MS = 8000;

function useChatKeys(order: string[], viewing: string, unread: string[]) {
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
}

function usePeekedGroups(live: LiveChat[], folders: Folder[], collapsed: Record<string, boolean>) {
  const [peeking, setPeeking] = useState<ReadonlySet<string>>(new Set());
  const peekTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const liveIds = useRef<Set<string> | null>(null);
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
  return { peeking, unpeek };
}

// Counts the times the tab becomes visible after being hidden.
function useShownCount() {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    let hidden = document.hidden;
    const onChange = () => {
      if (document.hidden) hidden = true;
      else if (hidden) { hidden = false; setShown((n) => n + 1); }
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return shown;
}

export function OpenChats() {
  const current = useStore((s) => s.session.sessionId);
  const cwd = useStore((s) => s.session.cwd);
  const live = useStore((s) => s.live);
  const { folders, chats, setChats } = useWorkspace(current + cwd);
  const savedById = useMemo(() => new Map(chats.map((s) => [s.sessionId, s])), [chats]);
  const [filter, setFilter] = useState('');
  const hits = useMessageSearch(filter);
  const viewing = useStore((s) => s.session.id);
  const [collapsed, setCollapsed] = useState(() => stored<Record<string, boolean>>(KEY, {}));
  const [full, setFull] = useState<Set<string>>(new Set());
  const [opening, setOpening] = useState<string | null>(null);
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);
  const [newIn, setNewIn] = useState<{ repo?: string } | null>(null);
  const actions = chatActions(setChats, setAsk);
  const { pins, setPin } = usePins();
  const pinSet = useMemo(() => new Set(pins), [pins]);
  const allGroups = useMemo(() => groupByRepo(live, chats, folders, '', pinSet), [live, chats, folders, pinSet]);
  const shown = useShownCount();
  const snapshot = useRef<HeldOrder | null>(null);
  snapshot.current = holdOrder(snapshot.current, allGroups, chats.length > 0, shown);
  const held = snapshot.current;
  const groups = useMemo(() => orderGroups(groupByRepo(live, chats, folders, filter, pinSet, held.chats), held.groups), [live, chats, folders, filter, pinSet, held]);
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
  const shownWaiting = useMemo(() => waitingChats(live, chats, folders, filter), [live, chats, folders, filter]);
  const order = useMemo(() => {
    const pinned = pins.flatMap((id) => live.filter((c) => c.sessionId === id));
    return chatOrder(waiting, pinned, orderGroups(groupByRepo(live, chats, folders, '', pinSet, held.chats), held.groups));
  }, [live, chats, folders, pins, pinSet, held]);
  const seen = useStore((s) => s.seen);
  const done = useMemo(() => doneChats(
    [...groups.flatMap((g) => g.open), ...pinnedRows.flatMap((p) => (p.c ? [p.c] : []))],
    [...groups.flatMap((g) => g.recent), ...pinnedRows.flatMap((p) => (p.s ? [p.s] : []))],
    seen,
    savedById,
  ), [groups, pinnedRows, seen, savedById]);
  const markAllRead = () => {
    done.forEach(markSeen);
    showSnack(`Marked ${plural(done.length, 'chat')} as read`, () => done.forEach(markUnread));
  };
  const unread = useMemo(() => order.filter((id) => {
    const c = live.find((x) => x.id === id);
    const state = c && chatState({ live: c, saved: c.sessionId ? savedById.get(c.sessionId) : undefined }, seen);
    return state === 'done' || state === 'needs';
  }), [order, live, savedById, seen]);
  useChatKeys(order, viewing, unread);
  const { peeking, unpeek } = usePeekedGroups(live, folders, collapsed);
  const isOpen = (g: RepoGroup) => Boolean(filter) || peeking.has(g.key) || !(collapsed[g.key] ?? !g.open.length);
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

  const openHit = (h: MessageHit) => {
    requestFind({ sessionId: h.sessionId, query: filter.trim(), at: h.at ? Date.parse(h.at) : null }, h.sessionId === current);
    if (h.sessionId !== current) {
      setOpening(h.sessionId);
      send({ type: 'open_session', sessionId: h.sessionId });
    }
  };

  useEffect(() => setOpening(null), [current]);
  // A failed or lost open never changes the current chat.
  useEffect(() => {
    if (!opening) return;
    const t = setTimeout(() => { takeFind(opening); setOpening(null); }, 20_000);
    return () => clearTimeout(t);
  }, [opening]);

  return (
    <div className="sessions chats">
      <div className="sessions-bar">
        <FilterInput value={filter} set={setFilter} />
        {done.length > 0 && <IconButton icon="check-all" label="Mark all as read" onClick={markAllRead} />}
        <IconButton icon="add" label="New session in a repo" onClick={() => setNewIn({})} />
      </div>
      <NeedsYou n={shownWaiting.length} filter={filter}>
        {shownWaiting.map((c) => row(c, repoName(folders, c.cwd)))}
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
                <IconButton icon="add" label={`New chat in ${g.name}`} size="sm" small onClick={(e) => { e.stopPropagation(); setNewIn({ repo: g.key }); }} />
              </span>
            </div>
            {isOpen(g) && g.open.filter((c) => !c.pending).map((c) => row(c))}
            {isOpen(g) && (full.has(g.key) || filter ? g.recent : g.recent.slice(0, RECENT)).map((s) => savedRow(s))}
            {isOpen(g) && !filter && g.recent.length > RECENT && (
              <ShowAll count={g.recent.length} open={full.has(g.key)} className="more" onClick={() => flip(setFull, g.key)} />
            )}
          </div>
        ))}
        {!groups.length && !hits.length && <EmptyState size="sm" title={filter ? 'No repo or chat matches' : 'No chats yet'} hint={filter ? undefined : 'Chats you start show here'} />}
        {hits.length > 0 && <div className="group">Messages</div>}
        {hits.map((h) => (
          <Row key={`${h.sessionId}-${h.role}-${h.at}`} title={markSegments(h.text, queryWords(filter)).map((x, i) => (x.hit ? <b key={i}>{x.text}</b> : x.text))} lines={2} meta={messageMeta(h)} onClick={() => openHit(h)} />
        ))}
        <Bin ask={setAsk} onRestore={(b) => setChats((l) => [{ sessionId: b.sessionId, title: b.title, cwd: b.cwd, gitBranch: null, lastModified: b.lastModified }, ...l])} />
      </div>
      {ask && <Confirm {...ask} onClose={() => setAsk(null)} />}
      {newIn && <NewChatSheet repo={newIn.repo} onClose={() => setNewIn(null)} />}
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

type MessageHit = { sessionId: string; role: 'user' | 'assistant'; text: string; at: string; title: string };

export const messageMeta = (h: Pick<MessageHit, 'title' | 'role' | 'at'>) => metaLine(h.title || 'Untitled', h.role === 'user' ? 'You' : 'Agent', h.at ? ago(h.at) : undefined);

// Prompts and replies of every chat matching the sidebar search, from 3 characters.
function useMessageSearch(filter: string) {
  const [hits, setHits] = useState<MessageHit[]>([]);
  useEffect(() => {
    const q = filter.trim();
    if (q.length < 3) { setHits([]); return; }
    let live = true;
    const t = setTimeout(() => searchMessages(q).then((l) => live && setHits(Array.isArray(l) ? l : []), () => live && setHits([])), 300);
    return () => { live = false; clearTimeout(t); };
  }, [filter]);
  return hits;
}

