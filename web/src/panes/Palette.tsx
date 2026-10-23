import { useEffect, useMemo, useRef, useState } from 'react';
import { deliver, getState, send, setUi, useStore } from '../store';
import { toggleNotify } from '../notify';
import { PERMISSION_MODES } from '../../../shared/protocol';
import { Hl } from './util';
import '../palette.css';

export type Command = { id: string; label: string; key?: string };
export type Match = { score: number; hits: number[] };
export type Row = { cmd: Command; hits: number[]; recent: boolean };

const KEY = 'agentview.palette';
const MAX_ROWS = 12;

const VIEWS = [
  ['explorer', 'Explorer'],
  ['changes', 'Source Control'],
  ['github', 'GitHub Pull Requests'],
  ['chats', 'Chats'],
  ['sessions', 'Workspace'],
];
const TABS = [['chat', 'Chat'], ['code', 'Code'], ['term', 'Terminal'], ['browser', 'Browser']];
const MODES: Record<string, string> = { default: 'Default', acceptEdits: 'Accept edits', plan: 'Plan mode', auto: 'Auto mode', dontAsk: "Don't ask" };

export function buildCommands(models: { value: string; displayName: string }[]): Command[] {
  return [
    ...VIEWS.map(([id, title]) => ({ id: `view:${id}`, label: `View: Show ${title}` })),
    ...TABS.map(([id, title]) => ({ id: `tab:${id}`, label: `Tab: ${title}` })),
    { id: 'terminal', label: 'View: Toggle Terminal', key: '⌘J' },
    { id: 'toggleSidebar', label: 'View: Toggle Left Sidebar', key: '⌘B' },
    { id: 'toggleChat', label: 'View: Toggle Chat', key: '⌥⌘B' },
    { id: 'page:observe', label: 'View: Observe' },
    { id: 'page:deploy', label: 'View: Deploy' },
    { id: 'page:mcp', label: 'View: MCP Servers' },
    { id: 'file', label: 'Go to File', key: '⌘P' },
    { id: 'repo', label: 'Chat: Open Repository', key: '⌘O' },
    { id: 'newChat', label: 'Chat: New Chat' },
    ...models.map((m) => ({ id: `model:${m.value}`, label: `Model: ${m.displayName}` })),
    ...PERMISSION_MODES.map((m) => ({ id: `mode:${m}`, label: `Permission Mode: ${MODES[m] ?? m}` })),
    { id: 'compact', label: 'Chat: Compact Context' },
    { id: 'loop', label: 'Chat: Toggle Plan, Build, Test Loop' },
    { id: 'stop', label: 'Chat: Stop Claude' },
    { id: 'theme', label: 'Preferences: Toggle Theme' },
    { id: 'notify', label: 'Preferences: Toggle Notifications' },
    { id: 'phone', label: 'Open on Phone' },
    { id: 'restart', label: 'Developer: Restart Server When Claude Is Idle' },
  ];
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
  const rows = commands.map((cmd) => ({ cmd, m: matchCommand(cmd.label, query) })).filter((r) => r.m) as { cmd: Command; m: Match }[];
  rows.sort((a, b) => {
    const ra = at(a.cmd), rb = at(b.cmd);
    if (isFinite(ra) !== isFinite(rb)) return ra - rb;
    return b.m.score - a.m.score || (ra === rb ? 0 : ra - rb);
  });
  return rows.slice(0, max).map((r) => ({ cmd: r.cmd, hits: r.m.hits, recent: isFinite(at(r.cmd)) }));
}

export function remember(recent: string[], id: string, max = MAX_ROWS): string[] {
  return [id, ...recent.filter((x) => x !== id)].slice(0, max);
}

function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function perform(id: string) {
  const [kind, ...rest] = id.split(':');
  const arg = rest.join(':');
  if (kind === 'model') send({ type: 'set_model', model: arg });
  else if (kind === 'mode') send({ type: 'set_permission_mode', mode: arg });
  else if (id === 'newChat') send({ type: 'new_session' });
  else if (id === 'compact') deliver({ type: 'prompt', text: '/compact' });
  else if (id === 'loop') send({ type: 'set_loop', on: !getState().session.loop.on });
  else if (id === 'stop') send({ type: 'interrupt' });
  else if (id === 'restart') send({ type: 'restart' });
  else if (id === 'file') setUi({ switcherOpen: true });
  else if (id === 'repo') setUi({ repoPicker: true });
  else if (id === 'notify') toggleNotify();
  window.dispatchEvent(new CustomEvent('agentview:command', { detail: { id } }));
}

export function Palette() {
  const models = useStore((s) => s.session.models);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const [recent, setRecent] = useState(loadRecent);
  const list = useRef<HTMLUListElement>(null);
  const commands = useMemo(() => buildCommands(models), [models]);
  const rows = useMemo(() => rankCommands(commands, q, recent), [commands, q, recent]);

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
    const next = remember(recent, cmd.id);
    setRecent(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {}
    close();
    perform(cmd.id);
  };

  return (
    <div className="overlay" onClick={close}>
      <div className="palette" role="dialog" aria-label="Command palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <span className="palette-prefix">&gt;</span>
          <input
            autoFocus
            value={q}
            placeholder="Type a command"
            spellCheck={false}
            onChange={(e) => { setQ(e.target.value); setIdx(0); }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close();
              else if (e.key === 'ArrowDown') setIdx((i) => Math.min(i + 1, Math.max(rows.length - 1, 0)));
              else if (e.key === 'ArrowUp') setIdx((i) => Math.max(i - 1, 0));
              else if (e.key === 'Enter' && rows[idx]) run(rows[idx].cmd);
              else return;
              e.preventDefault();
            }}
          />
        </div>
        <ul ref={list} role="listbox">
          {rows.map((r, i) => {
            const group = i === 0 && r.recent ? 'recently used' : !r.recent && rows[i - 1]?.recent ? 'other commands' : '';
            return (
              <li key={r.cmd.id} role="option" aria-selected={i === idx} className={i === idx ? 'active' : ''} onClick={() => run(r.cmd)}>
                <span className="palette-label"><Hl text={r.cmd.label} hits={r.hits} /></span>
                {r.cmd.key && <span className="palette-key">{r.cmd.key}</span>}
                {group && <span className="palette-group">{group}</span>}
              </li>
            );
          })}
        </ul>
        {!rows.length && <div className="palette-empty">No matching commands</div>}
      </div>
    </div>
  );
}
