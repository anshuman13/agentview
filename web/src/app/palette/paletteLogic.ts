import { EFFORT_LABEL, EFFORT_LEVELS, type Effort, type ProviderOption } from '../../../../shared/protocol';
import { providerModes, type ModeOption } from '../../../../shared/providers';
import { paletteFeature, shownFeature } from '../../../../shared/featureUse';
import { isBlock } from '../../../../shared/util';
import { codexMeetings } from '../../codex/data';
import { isTask, searchAll } from '../../codex/data/ask/search';
import { live } from '../../codex/data/wiki/wiki';
import type { Snapshot } from '../../codex/data/store';
import { rowKey } from '../../codex/data/sync';
import type { Filter } from '../../codex/view';
import { LISTS } from '../../codex/nav';

export type Command = { id: string; label: string; key?: string; pinned?: boolean };
export type Match = { score: number; hits: number[] };
export type Row = { cmd: Command; hits: number[]; recent: boolean };

export type PaletteItem = { kind: 'task' | 'meeting' | 'wiki'; profile: string; id: string; title: string; at: number | null };
export type ItemHit = { item: PaletteItem; hits: number[] };

export const KEY = 'agentview.palette';
export const ITEMS_KEY = 'agentview.palette.items';
export const MAX_RECENT_ITEMS = 5;
const MAX_ITEMS = 8;
export const MAX_ROWS = 12;
const MAX_PINNED = 20;

const VIEWS = [
  ['explorer', 'Explorer'],
  ['changes', 'Source Control'],
  ['github', 'GitHub Pull Requests'],
  ['chats', 'Sessions'],
  ['sessions', 'Workspace'],
  ['runs', 'Runs'],
];
const TABS = [['chat', 'Chat'], ['code', 'Files'], ['term', 'Terminal'], ['browser', 'Browser'], ['agents', 'Agents']];
export function buildCommands(models: { value: string; displayName: string }[], deploy: boolean, efforts: readonly Effort[] = EFFORT_LEVELS, providers: ProviderOption[] = [], modes: ModeOption[] = providerModes(), doc = false, hidden: string[] = []): Command[] {
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
    ...(deploy ? [{ id: 'page:deploy', label: 'View: Deploy' }] : []),
    { id: 'page:mcp', label: 'View: MCP Servers' },
    { id: 'page:builds', label: 'View: Builds' },
    { id: 'page:sketches', label: 'View: Sketches' },
    { id: 'file', label: 'Go to File', key: '⌘P' },
    { id: 'repo', label: 'Chat: Open Repository', key: '⌘O' },
    { id: 'newChat', label: 'Chat: New Chat' },
    ...providers.filter((p) => p.id !== 'claude').map((p) => ({ id: `newChat:${p.id}`, label: `Chat: New ${p.label} Chat${p.enabled ? '' : ` (${p.note})`}` })),
    { id: 'forkChat', label: 'Chat: Fork Chat' },
    ...models.map((m) => ({ id: `model:${m.value}`, label: `Model: ${m.displayName}` })),
    ...efforts.map((e) => ({ id: `effort:${e}`, label: `Effort: ${EFFORT_LABEL[e]}` })),
    ...modes.map((m) => ({ id: `mode:${m.value}`, label: `Permission Mode: ${m.label}` })),
    { id: 'compact', label: 'Chat: Compact Context' },
    { id: 'loop', label: 'Chat: Toggle Build Cycle' },
    { id: 'review', label: 'Chat: Toggle Review Changes' },
    { id: 'goal', label: 'Chat: New goal' },
    ...(doc ? [{ id: 'goalFile', label: 'File: Run as goal…' }] : []),
    { id: 'spec', label: 'Chat: Start with a spec' },
    { id: 'stop', label: 'Chat: Stop the Agent' },
    { id: 'theme', label: 'Preferences: Toggle Theme' },
    { id: 'notify', label: 'Preferences: Toggle Notifications' },
    { id: 'shortcuts', label: 'Keyboard shortcuts', key: '?' },
    { id: 'phone', label: 'Open on Phone' },
    { id: 'restart', label: 'Developer: Restart Server When Agents Are Idle' },
  ].filter((c) => {
    const feature = c.id.startsWith('page:') ? c.id : paletteFeature(c.id);
    return !feature || shownFeature(feature, hidden);
  });
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
