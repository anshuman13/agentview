import { useEffect, useMemo, useRef, useState } from 'react';
import { getState, send, setUi, useStore } from './store';
import { toggleNotify } from './notify';
import { EFFORT_LABEL, EFFORT_LEVELS, PERMISSION_MODES, type SavedSession } from '../../../shared/protocol';
import { Back } from './back';
import { openMeeting, openSearch, openTask, setView, useView, type Filter, type List } from '../codex/view';
import { assistantStore, codexMeetings } from '../codex/data';
import { isTask, searchAll } from '../codex/data/search';
import { live } from '../codex/data/wiki';
import type { Snapshot } from '../codex/data/store';
import { rowKey } from '../codex/data/sync';
import { clock } from '../codex/time';
import { isBlock } from '../../../shared/util';
import { Icon } from '../ui/Icon';
import { Row as UiRow } from '../ui/Row';
import { LISTS } from '../codex/nav';
import { PINS_URL, get } from '../sessions/folders';
import { Hl, ago, command, listKeys, save, storedStrings } from '../ui/util';

export type Command = { id: string; label: string; key?: string; pinned?: boolean };
export type Match = { score: number; hits: number[] };
export type Row = { cmd: Command; hits: number[]; recent: boolean };

export type PaletteItem = { kind: 'task' | 'meeting' | 'wiki'; profile: string; id: string; title: string; at: number | null };
export type ItemHit = { item: PaletteItem; hits: number[] };

const KEY = 'agentview.palette';
const ITEMS_KEY = 'agentview.palette.items';
const MAX_RECENT_ITEMS = 5;
const MAX_ITEMS = 8;
const MAX_ROWS = 12;
const MAX_PINNED = 20;

const VIEWS = [
  ['explorer', 'Explorer'],
  ['changes', 'Source Control'],
  ['github', 'GitHub Pull Requests'],
  ['chats', 'Sessions'],
  ['sessions', 'Workspace'],
];
const TABS = [['chat', 'Chat'], ['code', 'Files'], ['term', 'Terminal'], ['browser', 'Browser'], ['agents', 'Agents']];
const MODES: Record<string, string> = { default: 'Default', acceptEdits: 'Accept edits', plan: 'Plan mode', auto: 'Auto mode', dontAsk: "Don't ask" };

export function buildCommands(models: { value: string; displayName: string }[]): Command[] {
  return [
    ...VIEWS.map(([id, title]) => ({ id: `view:${id}`, label: `View: Show ${title}` })),
    ...TABS.map(([id, title]) => ({ id: `tab:${id}`, label: `Tab: ${title}` })),
    ...LISTS.map((l) => ({ id: `codex:${l.id}`, label: `Codex: ${l.label}` })),
    { id: 'codex:newtask', label: 'Codex: New task' },
    { id: 'terminal', label: 'View: Toggle Terminal', key: '⌘J' },
    { id: 'switchEditor', label: 'View: Switch File and Browser', key: '⌘E' },
    { id: 'toggleSidebar', label: 'View: Toggle Left Sidebar', key: '⌘B' },
    { id: 'toggleChat', label: 'View: Toggle Chat', key: '⌥⌘B' },
    { id: 'page:observe', label: 'View: Observe' },
    { id: 'page:deploy', label: 'View: Deploy' },
    { id: 'page:mcp', label: 'View: MCP Servers' },
    { id: 'file', label: 'Go to File', key: '⌘P' },
    { id: 'repo', label: 'Chat: Open Repository', key: '⌘O' },
    { id: 'newChat', label: 'Chat: New Chat' },
    { id: 'forkChat', label: 'Chat: Fork Chat' },
    ...models.map((m) => ({ id: `model:${m.value}`, label: `Model: ${m.displayName}` })),
    ...EFFORT_LEVELS.map((e) => ({ id: `effort:${e}`, label: `Effort: ${EFFORT_LABEL[e]}` })),
    ...PERMISSION_MODES.map((m) => ({ id: `mode:${m}`, label: `Permission Mode: ${MODES[m] ?? m}` })),
    { id: 'compact', label: 'Chat: Compact Context' },
    { id: 'loop', label: 'Chat: Toggle Plan, Build, Test Loop' },
    { id: 'stop', label: 'Chat: Stop Claude' },
    { id: 'theme', label: 'Preferences: Toggle Theme' },
    { id: 'notify', label: 'Preferences: Toggle Notifications' },
    { id: 'shortcuts', label: 'Keyboard shortcuts', key: '?' },
    { id: 'phone', label: 'Open on Phone' },
    { id: 'restart', label: 'Developer: Restart Server When Claude Is Idle' },
  ];
}

export function pinCommands(pins: string[], live: { sessionId: string | null; title: string }[], saved: { sessionId: string; title: string }[]): Command[] {
  return pins
    .flatMap((id) => {
      const title = live.find((c) => c.sessionId === id)?.title ?? saved.find((s) => s.sessionId === id)?.title;
      return title ? [{ id: `pin:${id}`, label: `Chat: ${title}`, pinned: true }] : [];
    })
    .slice(0, MAX_PINNED);
}

const boundary = (lower: string, i: number) => i === 0 || !/[a-z0-9]/.test(lower[i - 1]);

function matchWord(lower: string, w: string): Match | null {
  let best: Match | null = null;
  for (let at = lower.indexOf(w); at >= 0; at = lower.indexOf(w, at + 1)) {
    const score = 100 + (boundary(lower, at) ? 50 : 0) + (at === 0 ? 20 : 0);
    if (!best || score > best.score) best = { score, hits: Array.from(w, (_, i) => at + i) };
  }
  if (best) return best;
  const hits: number[] = [];
  let score = 0;
  let at = -1;
  for (const ch of w) {
    at = lower.indexOf(ch, at + 1);
    if (at < 0) return null;
    score += 1 + (boundary(lower, at) ? 3 : 0) + (hits[hits.length - 1] === at - 1 ? 2 : 0);
    hits.push(at);
  }
  return { score, hits };
}

export function matchCommand(label: string, query: string): Match | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return { score: 0, hits: [] };
  const lower = label.toLowerCase();
  const hits = new Set<number>();
  let score = 0;
  for (const w of words) {
    const m = matchWord(lower, w);
    if (!m) return null;
    score += m.score;
    m.hits.forEach((h) => hits.add(h));
  }
  return { score: score - label.length / 100, hits: [...hits].sort((a, b) => a - b) };
}

export function rankCommands(commands: Command[], query: string, recent: string[], max = MAX_ROWS): Row[] {
  const pos = new Map(recent.map((id, i) => [id, i]));
  const at = (cmd: Command) => pos.get(cmd.id) ?? Infinity;
  const empty = !query.trim();
  const rows = commands.map((cmd) => ({ cmd, m: matchCommand(cmd.label, query) })).filter((r) => r.m) as { cmd: Command; m: Match }[];
  rows.sort((a, b) => {
    const pa = Boolean(a.cmd.pinned), pb = Boolean(b.cmd.pinned);
    if (empty && pa !== pb) return pa ? -1 : 1;
    if (empty && pa) return 0;
    const ra = at(a.cmd), rb = at(b.cmd);
    if (isFinite(ra) !== isFinite(rb)) return ra - rb;
    return b.m.score - a.m.score || (pa === pb ? 0 : pa ? -1 : 1) || (ra === rb ? 0 : ra - rb);
  });
  return rows.slice(0, max).map((r) => ({ cmd: r.cmd, hits: r.m.hits, recent: isFinite(at(r.cmd)) }));
}

export function remember(recent: string[], id: string, max = MAX_ROWS): string[] {
  return [id, ...recent.filter((x) => x !== id)].slice(0, max);
}

export const itemKey = (i: { kind: string; profile: string; id: string }) => `${i.kind}:${rowKey(i)}`;

export function paletteItems(data: Pick<Snapshot, 'items' | 'meetings' | 'pages'>): PaletteItem[] {
  return [
    ...data.items.filter(isTask).map((r): PaletteItem => ({ kind: 'task', profile: r.profile, id: r.id, title: r.title || r.text || 'Untitled', at: null })),
    ...live(data.meetings).filter((m) => !isBlock(m.id)).map((m): PaletteItem => ({ kind: 'meeting', profile: m.profile, id: m.id, title: m.title || 'Meeting', at: m.starts_at })),
    ...live(data.pages).map((p): PaletteItem => ({ kind: 'wiki', profile: p.profile, id: p.id, title: p.title || 'Untitled', at: null })),
  ];
}

export function seeAllCount(data: Pick<Snapshot, 'items' | 'meetings' | 'facts' | 'pages' | 'jobs'>, filter: Filter, q: string): number {
  const keep = <T extends { profile: string }>(rows: T[]) => rows.filter((x) => filter === 'all' || x.profile === filter);
  return searchAll({ items: keep(data.items), meetings: keep(codexMeetings(data.meetings)), facts: keep(data.facts), pages: keep(data.pages), jobs: keep(data.jobs) }, q).total;
}

export function recentItems(items: PaletteItem[], recent: string[], max = MAX_RECENT_ITEMS): ItemHit[] {
  const byKey = new Map(items.map((i) => [itemKey(i), i]));
  return recent.flatMap((k) => byKey.get(k) ?? []).slice(0, max).map((item) => ({ item, hits: [] }));
}

export function rankItems(items: PaletteItem[], query: string, recent: string[], max = MAX_ITEMS): ItemHit[] {
  const pos = new Map(recent.map((k, i) => [k, i]));
  const at = (i: PaletteItem) => pos.get(itemKey(i)) ?? Infinity;
  const rows = items.flatMap((item) => { const m = matchCommand(item.title, query); return m ? [{ item, m }] : []; });
  rows.sort((a, b) => {
    const ra = at(a.item), rb = at(b.item);
    if (isFinite(ra) !== isFinite(rb)) return ra - rb;
    return (isFinite(ra) ? ra - rb : 0) || b.m.score - a.m.score;
  });
  return rows.slice(0, max).map((r) => ({ item: r.item, hits: r.m.hits }));
}

const KIND_LABEL = { task: 'Task', meeting: 'Meeting', wiki: 'Wiki' };

function itemMeta(i: PaletteItem) {
  const when = i.at == null ? '' : new Date(i.at).toDateString() === new Date().toDateString() ? clock(i.at) : ago(i.at);
  return [KIND_LABEL[i.kind], i.profile === 'work' ? 'Work' : 'Personal', when].filter(Boolean).join(' · ');
}

function openItem(i: PaletteItem) {
  if (i.kind === 'task') openTask(i);
  else if (i.kind === 'meeting') openMeeting(i);
  else setView({ list: 'wiki', open: i.id, anchor: null });
  command('assistant');
}

function perform(id: string) {
  const [kind, ...rest] = id.split(':');
  const arg = rest.join(':');
  if (kind === 'codex') {
    const add = arg === 'newtask';
    setView({ list: add ? 'tasks' : (arg as List), open: null, person: null });
    command('assistant');
    if (add) requestAnimationFrame(() => requestAnimationFrame(() => window.dispatchEvent(new Event('tasks:add'))));
    return;
  }
  if (kind === 'pin') {
    const chat = getState().live.find((c) => c.sessionId === arg);
    send(chat ? { type: 'view', id: chat.id } : { type: 'open_session', sessionId: arg });
  } else if (kind === 'model') send({ type: 'set_model', model: arg });
  else if (kind === 'effort') send({ type: 'set_effort', effort: arg });
  else if (kind === 'mode') send({ type: 'set_permission_mode', mode: arg });
  else if (id === 'newChat') send({ type: 'new_session' });
  else if (id === 'forkChat') {
    const sessionId = getState().session.sessionId;
    if (sessionId) send({ type: 'new_session', fork: sessionId });
  }
  else if (id === 'compact') send({ type: 'prompt', text: '/compact' });
  else if (id === 'loop') send({ type: 'set_loop', on: !getState().session.loop.on });
  else if (id === 'stop') send({ type: 'interrupt' });
  else if (id === 'restart') send({ type: 'restart' });
  else if (id === 'file') setUi({ switcherOpen: true });
  else if (id === 'repo') setUi({ repoPicker: true });
  else if (id === 'notify') toggleNotify();
  else if (id === 'shortcuts') window.dispatchEvent(new Event('agentview:shortcuts'));
  window.dispatchEvent(new CustomEvent('agentview:command', { detail: { id } }));
}

type Entry = { row: Row } | { item: ItemHit } | { all: number };

const entryGroup = (e: Entry, blank: boolean) => {
  if ('all' in e) return '';
  if ('item' in e) return blank ? 'Recently opened' : 'Items';
  return e.row.cmd.pinned && blank ? 'pinned chats' : e.row.recent ? 'recently used' : 'other commands';
};

export function Palette() {
  const models = useStore((s) => s.session.models);
  const live = useStore((s) => s.live);
  const [fetched, setFetched] = useState<{ pins: string[]; saved: SavedSession[] }>({ pins: [], saved: [] });
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const [recent, setRecent] = useState(() => storedStrings(KEY));
  const [recentOpened, setRecentOpened] = useState(() => storedStrings(ITEMS_KEY));
  const list = useRef<HTMLUListElement>(null);
  const pinned = useMemo(() => pinCommands(fetched.pins, live, fetched.saved), [fetched, live]);
  const commands = useMemo(() => [...pinned, ...buildCommands(models)], [pinned, models]);
  const rows = useMemo(() => rankCommands(commands, q, recent, MAX_ROWS + pinned.length), [commands, pinned, q, recent]);

  const items = useMemo(() => (open ? paletteItems(assistantStore().snapshot()) : []), [open]);
  const blank = !q.trim();
  const itemRows = useMemo(() => (blank ? recentItems(items, recentOpened) : rankItems(items, q, recentOpened)), [items, q, blank, recentOpened]);
  const { filter } = useView();
  const total = useMemo(() => {
    const snap = assistantStore().snapshot();
    return open && !blank && snap.phase === 'ready' ? seeAllCount(snap, filter, q) : 0;
  }, [open, blank, filter, q]);
  const all: Entry[] = total > 0 ? [{ all: total }] : [];
  const entries: Entry[] = blank
    ? [...itemRows.map((h) => ({ item: h })), ...rows.map((r) => ({ row: r }))]
    : [...rows.map((r) => ({ row: r })), ...itemRows.map((h) => ({ item: h })), ...all];

  useEffect(() => {
    if (!open) return;
    let stale = false;
    setFetched({ pins: [], saved: [] });
    void Promise.all([get(PINS_URL), get('/api/sessions')]).then(([pins, saved]) => !stale && pins && setFetched({ pins, saved: saved ?? [] }));
    return () => { stale = true; };
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const combo = (e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'p';
      if (!combo && e.key !== 'F1') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen((v) => !v);
      setQ('');
      setIdx(0);
      setUi({ switcherOpen: false, repoPicker: false });
    };
    const onOpen = () => { setOpen(true); setQ(''); setIdx(0); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('agentview:palette', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('agentview:palette', onOpen);
    };
  }, []);

  useEffect(() => {
    list.current?.children[idx]?.scrollIntoView({ block: 'nearest' });
  }, [idx]);

  if (!open) return null;

  const close = () => setOpen(false);
  const run = (cmd: Command) => {
    if (!cmd.pinned) {
      const next = remember(recent, cmd.id);
      setRecent(next);
      save(KEY, next);
    }
    close();
    perform(cmd.id);
  };

  const runItem = (i: PaletteItem) => {
    const next = remember(recentOpened, itemKey(i), MAX_RECENT_ITEMS);
    setRecentOpened(next);
    save(ITEMS_KEY, next);
    close();
    openItem(i);
  };
  const runAll = () => {
    close();
    openSearch(q);
    command('assistant');
  };
  const enter = (e?: Entry) => e && ('row' in e ? run(e.row.cmd) : 'all' in e ? runAll() : runItem(e.item.item));

  return (
    <div className="overlay" onClick={close}>
      <Back close={close} />
      <div className="palette" role="dialog" aria-label="Command palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <span className="palette-prefix">&gt;</span>
          <input
            autoFocus
            value={q}
            placeholder="Type a command"
            spellCheck={false}
            onChange={(e) => { setQ(e.target.value); setIdx(0); }}
            onKeyDown={listKeys({ count: entries.length, idx, setIdx, onEnter: () => enter(entries[idx]), onEscape: close })}
          />
        </div>
        <ul ref={list} role="listbox">
          {entries.map((e, i) => {
            const label = entryGroup(e, blank);
            const group = label !== (entries[i - 1] ? entryGroup(entries[i - 1], blank) : 'other commands') ? label : '';
            const active = { role: 'option', 'aria-selected': i === idx, className: i === idx ? 'active' : '' } as const;
            if ('all' in e) {
              return (
                <li key="see-all" {...active} className={`${active.className} palette-item`} onClick={runAll}>
                  <UiRow plain title={`See all ${e.all} results`} meta={`"${q.trim()}"`} trailing={<Icon name="chevron-right" />} />
                </li>
              );
            }
            if ('item' in e) {
              const { item, hits } = e.item;
              return (
                <li key={itemKey(item)} {...active} className={`${active.className} palette-item`} onClick={() => runItem(item)}>
                  <UiRow plain title={<Hl text={item.title} hits={hits} />} meta={itemMeta(item)} trailing={group && <span className="palette-group">{group}</span>} />
                </li>
              );
            }
            const r = e.row;
            return (
              <li key={r.cmd.id} {...active} onClick={() => run(r.cmd)}>
                <span className="palette-label"><Hl text={r.cmd.label} hits={r.hits} /></span>
                {r.cmd.key && <span className="palette-key">{r.cmd.key}</span>}
                {group && <span className="palette-group">{group}</span>}
              </li>
            );
          })}
        </ul>
        {!entries.length && <div className="palette-empty">Nothing matches</div>}
      </div>
    </div>
  );
}
