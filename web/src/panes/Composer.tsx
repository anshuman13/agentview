import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, getState, notice, prompt, send, sinceHeard, steer, useStore } from '../store';
import { Icon } from '../Icon';
import { Voice, useDictation } from './Voice';
import { QuickPick } from '../QuickPick';
import { FileIcon } from './Explorer';
import { match } from './FileSwitcher';
import { toolId } from './McpStatus';
import { touch } from '../touch';
import { apiUrl } from '../api';
import { Hl, wsUrl } from './util';
import { COMPACT_AT, EFFORT_LABEL, EFFORT_LEVELS, MAX_GOAL_ROUNDS, PERMISSION_MODES, type Account, type ChatEvent } from '../../../shared/protocol';

export type Trigger = { kind: 'command' | 'file'; start: number; query: string } | { kind: 'shell' } | null;

export type Ranked<T> = { item: T; hits: number[]; score: number };

export type Use = { server: string; tool?: string };

export const MAX_ROWS = 8;
export const MAX_STORED = 50;
export const ACCOUNT_LABEL: Record<Account, string> = { main: 'Personal', alt: 'Work' };
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

export function triggerAt(text: string, caret: number): Trigger {
  if (text.startsWith('!')) return { kind: 'shell' };
  const before = text.slice(0, Math.min(caret, text.length));
  const m = /(?:^|\s)([/@])(\S*)$/.exec(before);
  if (!m) return null;
  return { kind: m[1] === '/' ? 'command' : 'file', start: before.length - 1 - m[2].length, query: m[2] };
}

function rank<T>(items: T[], key: (t: T) => string, query: string, limit: number): Ranked<T>[] {
  const out: Ranked<T>[] = [];
  for (const item of items) {
    const m = match(key(item), query);
    if (m) out.push({ item, hits: m.hits, score: m.score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

export const rankCommands = <T extends { name: string }>(commands: T[], query: string, limit = MAX_ROWS) => rank(commands, (c) => c.name, query, limit);

export const rankFiles = (files: string[], query: string, limit = MAX_ROWS) => rank(files, (f) => f, query, limit);

export function accept(text: string, start: number, caret: number, insert: string) {
  const next = `${text.slice(0, start)}${insert} ${text.slice(caret)}`;
  return { text: next, caret: start + insert.length + 1 };
}

export function addUse(uses: Use[], u: Use): Use[] {
  const keep = (x: Use) => x.server !== u.server || (!!u.tool && !!x.tool && x.tool !== u.tool);
  return [...uses.filter(keep), u];
}

export const useLabel = (u: Use) => (u.tool ? toolId(u.server, u.tool) : u.server);

export function withUses(text: string, uses: Use[]) {
  if (!uses.length || text.startsWith('/')) return text;
  const names = uses.map((u) => (u.tool ? `the ${toolId(u.server, u.tool)} tool` : `the ${u.server} MCP server`));
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  return `${text}\n\nUse ${list} for this.`;
}

export function buildHistory(events: ChatEvent[], stored: string[]) {
  const local = events.filter((e) => e.kind === 'user').map((e) => e.text.trim()).reverse();
  const out: string[] = [];
  for (const t of [...local, ...[...stored].reverse()]) {
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

export function ghostFor(text: string, history: string[]) {
  if (text.length < 3) return '';
  const hit = history.find((h) => h.length > text.length && h.startsWith(text));
  return hit ? hit.slice(text.length) : '';
}

export const remember = (text: string, stored: string[], max = MAX_STORED) => [...stored.filter((t) => t !== text), text].slice(-max);

export function filesEdited(events: ChatEvent[]) {
  const paths = new Set<string>();
  for (const e of events) {
    if (e.kind === 'tool_use' && EDIT_TOOLS.has(e.name) && typeof e.input.file_path === 'string') paths.add(e.input.file_path);
  }
  return paths.size;
}

let editedFor: ChatEvent[] | undefined;
let editedCount = 0;
const editedOf = (events: ChatEvent[]) => (events === editedFor ? editedCount : ((editedFor = events), (editedCount = filesEdited(events))));

export const contextPercent = (context: number | null) => (context === null ? null : Math.min(100, Math.round((context / COMPACT_AT) * 100)));

const MODES: Record<string, { label: string; detail: string; icon: string }> = {
  default: { label: 'Default', detail: 'Ask before edits and risky commands', icon: 'shield' },
  acceptEdits: { label: 'Accept edits', detail: 'Edit files without asking, ask for the rest', icon: 'edit' },
  plan: { label: 'Plan', detail: 'Read and plan, no edits', icon: 'eye' },
  auto: { label: 'Auto', detail: 'Claude runs what is safe and asks only for risky actions', icon: 'zap' },
  dontAsk: { label: "Don't ask", detail: 'Deny anything not pre-approved', icon: 'circle-slash' },
};

const STORED_KEY = 'agentview.prompts';

const LOOP_ITEMS = [
  { value: 'off', label: 'Off', detail: 'Prompts run as usual' },
  ...[1, 2, 3, 5].map((n) => ({ value: String(n), label: `Up to ${n} ${n === 1 ? 'round' : 'rounds'}`, detail: 'Opus plans and builds, Sonnet tests and reports, Opus fixes what fails' })),
];

const PHASES: Record<string, string> = { plan: 'Planning with Opus', build: 'Building with Opus', test: 'Testing with Sonnet', passed: 'Loop passed', failed: 'Loop stopped' };

export const clock = (t: number) => new Date(t).toTimeString().slice(0, 5);
const span = (ms: number) => (ms % 3_600_000 === 0 ? `${ms / 3_600_000}h` : `${Math.round(ms / 60_000)}m`);
const once = (r: { every: number; until: number | null; nextAt: number | null }) => !r.every && r.until !== null && r.nextAt !== null && r.until - r.nextAt <= 1000;
export const repeatLabel = (r: { every: number; until: number | null; round: number; nextAt: number | null; goal?: string }) =>
  r.goal ? `Goal check ${r.round} of ${MAX_GOAL_ROUNDS}: ${r.goal}` : once(r) ? `Continues once at ${clock(r.nextAt!)}` : `Loop round ${r.round}, ${r.every ? `every ${span(r.every)}` : 'back to back'}${r.until ? ` until ${clock(r.until)}` : ''}`;

export const repeatPill = (r: { every: number; until: number | null; round: number; nextAt: number | null; goal?: string }) =>
  r.goal ? `Goal ${r.round}/${MAX_GOAL_ROUNDS}${r.nextAt ? ` · next ${clock(r.nextAt)}` : ''}` : once(r) ? `Continue at ${clock(r.nextAt!)}` : `Loop ${r.round}${r.nextAt ? ` · next ${clock(r.nextAt)}` : ''}${r.until ? ` · until ${clock(r.until)}` : ''}`;
export const loopLabel = (loop: { phase: string | null; round: number; max: number }) => (loop.phase ? `${PHASES[loop.phase] ?? loop.phase}${['plan', 'build', 'test'].includes(loop.phase) && loop.max > 1 ? ` · round ${loop.round}/${loop.max}` : ''}` : '');
const MAX_HEIGHT = 220;
const fileCache = new Map<string, string[]>();

const draftKey = (chat: string) => `agentview.draft.${chat}`;

function readDraft(chat: string) {
  try {
    return localStorage.getItem(draftKey(chat)) ?? '';
  } catch {
    return '';
  }
}

function saveDraft(chat: string, text: string) {
  try {
    if (text) localStorage.setItem(draftKey(chat), text);
    else localStorage.removeItem(draftKey(chat));
  } catch {}
}

function readStored(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORED_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

async function runInTerminal(cmd: string) {
  const list: Array<{ id: string }> = await fetch(api('/api/terms')).then((r) => r.json());
  const term = list.at(-1) ?? (await fetch(api('/api/terms'), { method: 'POST' }).then((r) => r.json()));
  window.dispatchEvent(new CustomEvent('agentview:terminal', { detail: term.id }));
  const ws = new WebSocket(wsUrl(`term=${encodeURIComponent(term.id)}`));
  ws.onopen = () => {
    ws.send(JSON.stringify({ t: 'i', d: `${cmd}\r` }));
    ws.close();
  };
}

type Hist = { list: string[]; index: number; draft: string };

export function Composer() {
  const cwd = useStore((s) => s.session.cwd);
  const chat = useStore((s) => s.session.id);
  const sessionId = useStore((s) => s.session.sessionId);
  const running = useStore((s) => s.session.running);
  const stopping = useStore((s) => s.session.stopping);
  const compacting = useStore((s) => s.session.compacting);
  const waiting = useStore((s) => s.pending.length > 0);
  const commands = useStore((s) => s.session.commands);
  const mode = useStore((s) => s.session.permissionMode) ?? 'default';
  const model = useStore((s) => s.session.model);
  const models = useStore((s) => s.session.models);
  const effort = useStore((s) => s.session.effort);
  const account = useStore((s) => s.session.account) ?? 'main';
  const accounts = useStore((s) => s.session.accounts) ?? [];
  const team = useStore((s) => s.session.team);
  const loop = useStore((s) => s.session.loop);
  const repeat = useStore((s) => s.session.repeat);
  const [stale, setStale] = useState(0);
  useEffect(() => {
    const tick = () => setStale(document.visibilityState === 'visible' ? sinceHeard() : 0);
    const t = setInterval(tick, 5_000);
    return () => clearInterval(t);
  }, []);
  const context = useStore((s) => s.session.context);
  const userCount = useStore((s) => s.events.reduce((n, e) => n + (e.kind === 'user' ? 1 : 0), 0));
  const edited = useStore((s) => editedOf(s.events));
  const servers = useStore((s) => s.session.mcp).filter((m) => m.status === 'connected');

  const [pick, setPick] = useState<{ kind: 'menu' | 'model' | 'effort' | 'account' | 'mode' | 'loop' | 'saved' | 'mcp' | 'mcpTools'; at: DOMRect; server?: string } | null>(null);
  const [uses, setUses] = useState<Use[]>([]);
  const [text, setText] = useState(() => readDraft(chat));
  const draftFor = useRef(chat);
  const picker = useRef<HTMLInputElement>(null);
  const [caret, setCaret] = useState(0);
  const [sel, setSel] = useState(0);
  const [dismissed, setDismissed] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [stored, setStored] = useState(readStored);
  const [hist, setHist] = useState<Hist | null>(null);
  const dictate = useDictation(text, setText);
  const ta = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLUListElement>(null);
  const wantCaret = useRef<number | null>(null);

  const at = Math.min(caret, text.length);
  const trigger = useMemo(() => triggerAt(text, at), [text, at]);
  const shell = trigger?.kind === 'shell';
  const popKey = trigger && trigger.kind !== 'shell' ? `${trigger.kind}:${trigger.start}:${trigger.query}` : '';
  const items = useMemo(() => {
    if (!trigger || trigger.kind === 'shell' || popKey === dismissed) return [];
    return trigger.kind === 'command' ? rankCommands(commands, trigger.query) : rankFiles(files, trigger.query);
  }, [trigger, popKey, dismissed, commands, files]);
  const open = items.length > 0;
  const history = useMemo(() => buildHistory(getState().events, stored), [chat, userCount, stored]);
  const ghost = !open && !shell && at === text.length ? ghostFor(text, history) : '';
  const pct = contextPercent(context);
  const modelName = team ? 'Team' : models.find((m) => m.value === (model ?? 'default'))?.displayName ?? model ?? 'Default';
  const shortModel = modelName.replace(/\s*\(.*\)$/, '').replace(/^claude-([a-z]+)-(\d+)-(\d+).*$/, (_, n: string, a, b) => `${n[0].toUpperCase()}${n.slice(1)} ${a}.${b}`);
  const effortName = effort ? EFFORT_LABEL[effort] : 'Default';
  const modeInfo = MODES[mode] ?? { label: mode, detail: mode, icon: 'shield' };
  const cycleMode = () => send({ type: 'set_permission_mode', mode: PERMISSION_MODES[(PERMISSION_MODES.indexOf(mode as never) + 1) % PERMISSION_MODES.length] });

  useEffect(() => {
    if (trigger?.kind !== 'file' || !cwd) return;
    const cached = fileCache.get(cwd);
    if (cached) { setFiles(cached); return; }
    fetch(api('/api/files')).then((r) => r.json()).then((f: string[]) => { fileCache.set(cwd, f); setFiles(f); }).catch(() => {});
  }, [trigger?.kind, cwd]);

  useEffect(() => {
    if (draftFor.current === chat) return saveDraft(chat, text);
    draftFor.current = chat;
    setText(readDraft(chat));
    setUses([]);
  }, [chat, text]);

  useEffect(() => setSel(0), [popKey]);

  useEffect(() => {
    pop.current?.children[sel]?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = '0';
    const h = Math.max(el.scrollHeight, mirror.current?.offsetHeight ?? 0);
    el.style.height = `${Math.min(h, MAX_HEIGHT)}px`;
    if (mirror.current) mirror.current.style.visibility = h > MAX_HEIGHT ? 'hidden' : '';
    if (wantCaret.current !== null) {
      el.setSelectionRange(wantCaret.current, wantCaret.current);
      setCaret(wantCaret.current);
      wantCaret.current = null;
    }
  }, [text, ghost]);

  useLayoutEffect(() => {
    const el = pop.current;
    const anchor = card.current;
    if (!el || !anchor) return;
    const r = anchor.getBoundingClientRect();
    el.style.left = `${r.left}px`;
    el.style.width = `${r.width}px`;
    if (r.top - 8 >= el.offsetHeight) { el.style.bottom = `${window.innerHeight - r.top + 4}px`; el.style.top = ''; }
    else { el.style.top = `${r.bottom + 4}px`; el.style.bottom = ''; }
  }, [items]);

  const apply = (next: string, c = next.length) => {
    wantCaret.current = c;
    setText(next);
  };

  const choose = (i: number) => {
    if (!trigger || trigger.kind === 'shell' || !items[i]) return;
    const value = trigger.kind === 'command' ? `/${(items[i].item as { name: string }).name}` : `@${items[i].item as string}`;
    const r = accept(text, trigger.start, at, value);
    apply(r.text, r.caret);
  };

  const stepHistory = (dir: 1 | -1) => {
    const h = hist ?? { list: history, index: -1, draft: text };
    const index = Math.min(h.list.length - 1, h.index + dir);
    if (index < 0) { setHist(null); apply(h.draft); return; }
    setHist({ ...h, index });
    apply(h.list[index]);
  };

  const attach = async (list: File[]) => {
    for (const f of list) {
      try {
        const r = await fetch(apiUrl(`/api/paste?name=${encodeURIComponent(f.name || 'pasted')}`), { method: 'POST', headers: { 'content-type': f.type || 'application/octet-stream' }, body: f });
        const body = await r.json();
        if (!r.ok) throw new Error(body.error);
        setText((t) => `${t}${t && !/\s$/.test(t) ? ' ' : ''}[${f.type.startsWith('image/') ? 'Image' : 'File'}: ${body.path}] `);
      } catch (err) {
        notice(`Could not attach ${f.name || 'the file'}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    ta.current?.focus();
  };

  useEffect(() => {
    const shell = (window as { AgentViewShell?: { takeShared?: () => string } }).AgentViewShell;
    if (!shell?.takeShared) return;
    const take = () => {
      try {
        const items = JSON.parse(shell.takeShared!() || '[]') as { name: string; type: string; data: string; text?: string }[];
        for (const it of items) {
          if (it.text) setText((t) => `${t}${t && !/\s$/.test(t) ? ' ' : ''}${it.text} `);
          else void attach([new File([Uint8Array.from(atob(it.data), (c) => c.charCodeAt(0))], it.name, { type: it.type })]);
        }
      } catch {
        notice('Could not read what was shared');
      }
    };
    take();
    window.addEventListener('agentview:shared', take);
    return () => window.removeEventListener('agentview:shared', take);
  }, []);

  useEffect(() => {
    const insert = (e: Event) => {
      const add = (e as CustomEvent<{ text: string }>).detail.text;
      setText((t) => {
        const next = `${t}${t && !/\s$/.test(t) ? ' ' : ''}${add}`;
        wantCaret.current = next.length;
        return next;
      });
      requestAnimationFrame(() => ta.current?.focus());
    };
    window.addEventListener('agentview:insert', insert);
    return () => window.removeEventListener('agentview:insert', insert);
  }, []);

  useEffect(() => {
    const use = (e: Event) => {
      setUses((u) => addUse(u, (e as CustomEvent<Use>).detail));
      requestAnimationFrame(() => ta.current?.focus());
    };
    window.addEventListener('agentview:use', use);
    return () => window.removeEventListener('agentview:use', use);
  }, []);

  useEffect(() => {
    const focus = () => requestAnimationFrame(() => ta.current?.focus());
    window.addEventListener('agentview:focus', focus);
    return () => window.removeEventListener('agentview:focus', focus);
  }, []);

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    if (shell) {
      const cmd = t.slice(1).trim();
      if (cmd) runInTerminal(cmd).catch(() => notice('Terminal unavailable'));
    } else {
      const next = remember(t, stored);
      setStored(next);
      try { localStorage.setItem(STORED_KEY, JSON.stringify(next)); } catch {}
      const full = withUses(t, uses);
      const lost = () => setText((cur) => (cur.trim() ? cur : t));
      if (running) steer(full, lost);
      else prompt(full, lost);
      if (full !== t) setUses([]);
    }
    setHist(null);
    apply('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    const el = e.currentTarget;
    const onEntry = hist !== null && text === hist.list[hist.index];
    if (open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => (i + 1) % items.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => (i - 1 + items.length) % items.length); return; }
      if (e.key === 'Escape') { e.preventDefault(); setDismissed(popKey); return; }
      const exact = trigger?.kind === 'command' && (items[sel].item as { name: string }).name === trigger.query;
      if ((e.key === 'Tab' && !e.shiftKey) || (e.key === 'Enter' && !e.shiftKey && !exact)) { e.preventDefault(); choose(sel); return; }
    }
    if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); cycleMode(); return; }
    if (ghost && (e.key === 'Tab' || e.key === 'ArrowRight') && el.selectionStart === text.length) { e.preventDefault(); apply(text + ghost); return; }
    if (e.key === 'ArrowUp' && (text === '' || onEntry) && !text.slice(0, el.selectionStart).includes('\n')) { e.preventDefault(); stepHistory(1); return; }
    if (e.key === 'ArrowDown' && onEntry && !text.slice(el.selectionEnd).includes('\n')) { e.preventDefault(); stepHistory(-1); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  const typed = text.trim().length > 0;
  const hint = shell ? 'Runs in the terminal' : '';
  const placeholder = waiting ? 'Answer below, or message Claude to stop and send' : compacting ? 'Sends when compacting is done' : running ? 'Enter stops Claude and sends' : uses.length ? 'What should Claude do with it?' : 'Ask anything · / commands · @ files';
  const level = context === null ? '' : context >= COMPACT_AT ? 'over' : context >= COMPACT_AT * 0.75 ? 'near' : '';

  return (
    <div className="cp" data-mode={mode}>
      <div
        ref={card}
        className={`cp-card${shell ? ' shell' : ''}`}
        onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
        onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); void attach([...e.dataTransfer.files]); } }}
      >
        {uses.length > 0 && (
          <div className="cp-uses">
            {uses.map((u) => (
              <span key={useLabel(u)} className="cp-use" title={u.tool ? `Claude is asked to use ${toolId(u.server, u.tool)}` : `Claude is asked to use the ${u.server} MCP server`}>
                <Icon name="plug" small /><span>{u.server}</span>{u.tool && <span className="mono">{u.tool}</span>}
                <button className="icon-btn" aria-label={`Remove ${u.tool ?? u.server}`} onClick={() => setUses((l) => l.filter((x) => x !== u))}><Icon name="close" small /></button>
              </span>
            ))}
          </div>
        )}
        <div className="cp-text">
          <div ref={mirror} className="cp-mirror" aria-hidden><span className="cp-typed">{text}</span><span className="cp-ghost">{ghost}</span></div>
          <textarea
            ref={ta}
            value={text}
            rows={1}
            placeholder={placeholder}
            spellCheck={!shell}
            onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart); }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); void attach([...e.clipboardData.files]); } }}
          />
        </div>
        {ghost && touch() && (
          <button className="cp-suggest" title="Use this suggestion" onPointerDown={(e) => e.preventDefault()} onClick={() => apply(text + ghost)}>
            <Icon name="arrow-right" small /><span>{text.length > 12 && '…'}{text.slice(-12)}<b>{ghost}</b></span>
          </button>
        )}
        <div className="cp-foot">
          <button className={`cp-pill cp-chip${loop.on ? ' loop' : ''}`} title={`${modeInfo.detail} (Shift+Tab to switch mode)${loop.on ? `. Loop on, up to ${loop.max} ${loop.max === 1 ? 'round' : 'rounds'}` : ''}`} onClick={(e) => setPick({ kind: 'menu', at: e.currentTarget.getBoundingClientRect() })}>
            <Icon name={modeInfo.icon} small /><span>{shortModel}{effort && ` · ${effortName}`} · {modeInfo.label}</span>{loop.on && <Icon name="sync" small />}<Icon name="chevron-down" small />
          </button>
          <span className="cp-spacer" />
          {servers.length > 0 && (
            <button className={`icon-btn mcp${uses.length ? ' on' : ''}`} title="Ask Claude to use an MCP server or tool" aria-label="Use an MCP server" onClick={(e) => setPick({ kind: 'mcp', at: e.currentTarget.getBoundingClientRect() })}>
              <Icon name="plug" small />
            </button>
          )}
          <input ref={picker} type="file" multiple hidden onChange={(e) => { void attach([...(e.target.files ?? [])]); e.target.value = ''; }} />
          <button className="icon-btn attach" title="Add files for Claude to look at (or paste or drop them)" aria-label="Add files" onClick={() => picker.current?.click()}>
            <Icon name="file-add" small />
          </button>
          <Voice onText={dictate} />
          {running && !typed ? (
            <button className="cp-stop" title={stopping ? 'Stopping…' : 'Stop Claude'} aria-label={stopping ? 'Stopping' : 'Stop'} disabled={stopping} onClick={() => send({ type: 'interrupt' })}>
              <Icon name={stopping ? 'loading' : 'debug-stop'} small spin={stopping} />
            </button>
          ) : (
            <button
              className="cp-send"
              title={shell ? 'Run in the terminal (Enter)' : compacting ? 'Sends when compacting is done (Enter)' : running ? 'Stop Claude and send (Enter)' : 'Send (Enter)'}
              aria-label={shell ? 'Run' : running ? 'Stop and send' : 'Send'}
              disabled={!typed}
              onClick={() => submit()}
            >
              <Icon name={shell ? 'terminal' : 'arrow-up'} small />
            </button>
          )}
        </div>
      </div>
      <div className="cp-under">
        {hint && <span className="cp-hint">{hint}</span>}
        <span className="cp-stats">
          {compacting ? <span><Icon name="loading" small spin /> Compacting…</span> : level && (
            <button className={`cp-ctx ${level}`} disabled={running} title={`${context!.toLocaleString()} tokens in context. ${running ? 'Compacts when this turn ends' : 'Tap to compact'}.`} onClick={() => send({ type: 'prompt', text: '/compact' })}>{pct}% context{!running && ' · compact'}</button>
          )}
          {edited > 0 && <span>{edited} {edited === 1 ? 'file' : 'files'} edited</span>}
          {loop.phase && <span className={`cp-phase ${loop.phase}`}>{loopLabel(loop)}</span>}
          {stale >= 30 && <span className="cp-phase cp-stale" title="Nothing has arrived from the server. The link is reopened after 50 s of silence.">No update for {stale}s</span>}
          {repeat && <button className="cp-ctx cp-phase" title={`${repeatLabel(repeat)}. Tap to stop ${repeat.goal ? 'checking' : 'the loop'}.`} onClick={() => send({ type: 'prompt', text: repeat.goal ? '/goal off' : '/loop off' })}>{repeatPill(repeat)}</button>}
        </span>
      </div>
      {open && (
        <ul ref={pop} className="cp-pop" role="listbox">
          {items.map((r, i) => {
            if (trigger?.kind === 'command') {
              const c = r.item as { name: string; description: string };
              return (
                <li key={c.name} role="option" aria-selected={i === sel} className={i === sel ? 'active' : ''} onMouseDown={(e) => { e.preventDefault(); choose(i); }}>
                  <span className="cp-name">/<Hl text={c.name} hits={r.hits} /></span>
                  <span className="cp-detail">{c.description}</span>
                </li>
              );
            }
            const f = r.item as string;
            const base = f.lastIndexOf('/') + 1;
            return (
              <li key={f} role="option" aria-selected={i === sel} className={i === sel ? 'active' : ''} title={f} onMouseDown={(e) => { e.preventDefault(); choose(i); }}>
                <FileIcon name={f} />
                <span className="cp-name"><Hl text={f.slice(base)} hits={r.hits} from={base} /></span>
                <span className="cp-detail"><Hl text={f.slice(0, Math.max(base - 1, 0))} hits={r.hits} /></span>
              </li>
            );
          })}
        </ul>
      )}
      {pick?.kind === 'menu' && (
        <QuickPick
          anchor={pick.at}
          title="Chat settings"
          items={[
            { value: 'mode', label: 'Permission mode', detail: modeInfo.label },
            { value: 'model', label: 'Model', detail: modelName },
            { value: 'effort', label: 'Effort', detail: effortName },
            ...(accounts.length > 1 || account !== 'main' ? [{ value: 'account', label: 'Claude account', detail: ACCOUNT_LABEL[account] }] : []),
            { value: 'loop', label: 'Plan, build, test loop', detail: loop.on ? `Up to ${loop.max} ${loop.max === 1 ? 'round' : 'rounds'}` : 'Off' },
            { value: 'saved', label: 'Saved prompts', detail: `${stored.length}` },
            ...(sessionId ? [{ value: 'fork', label: 'Fork chat', detail: 'Continue this conversation in a new chat' }] : []),
          ]}
          onPick={(v) => {
            if (v === 'fork') { send({ type: 'new_session', fork: sessionId! }); setPick(null); return; }
            setPick({ kind: v as 'mode' | 'model' | 'effort' | 'account' | 'loop' | 'saved', at: pick.at });
          }}
          onClose={() => setPick(null)}
        />
      )}
      {pick?.kind === 'model' && (
        <QuickPick
          anchor={pick.at}
          title="Select model"
          current={team ? 'team' : model}
          items={models.map((m) => ({ value: m.value, label: m.displayName, detail: m.description }))}
          onPick={(v) => { send({ type: 'set_model', model: v }); setPick(null); }}
          onClose={() => setPick(null)}
        />
      )}
      {pick?.kind === 'effort' && (
        <QuickPick
          anchor={pick.at}
          title="Select effort"
          current={effort}
          items={EFFORT_LEVELS.map((e) => ({ value: e, label: EFFORT_LABEL[e] }))}
          onPick={(v) => { send({ type: 'set_effort', effort: v }); setPick(null); }}
          onClose={() => setPick(null)}
        />
      )}
      {pick?.kind === 'account' && (
        <QuickPick
          anchor={pick.at}
          title="Select Claude account"
          current={account}
          items={accounts.map((a) => ({ value: a, label: ACCOUNT_LABEL[a] }))}
          onPick={(v) => { send({ type: 'set_account', account: v }); setPick(null); }}
          onClose={() => setPick(null)}
        />
      )}
      {pick?.kind === 'loop' && (
        <QuickPick
          anchor={pick.at}
          title="Plan, build, test loop"
          current={loop.on ? String(loop.max) : 'off'}
          items={LOOP_ITEMS}
          onPick={(v) => { send(v === 'off' ? { type: 'set_loop', on: false } : { type: 'set_loop', on: true, max: Number(v) }); setPick(null); }}
          onClose={() => setPick(null)}
        />
      )}
      {pick?.kind === 'saved' && (
        <QuickPick
          anchor={pick.at}
          title="Saved prompts"
          items={[...stored].reverse().map((t, i) => ({ value: String(i), label: t.replace(/\s+/g, ' ').slice(0, 200) }))}
          onPick={(v) => { apply([...stored].reverse()[Number(v)]); setPick(null); ta.current?.focus(); }}
          onClose={() => setPick(null)}
        />
      )}
      {pick?.kind === 'mcp' && (
        <QuickPick
          anchor={pick.at}
          title="Use an MCP server"
          items={servers.map((m) => ({ value: m.name, label: m.name, detail: `${m.tools?.length ?? 0} tools` }))}
          onPick={(v) => setPick({ kind: 'mcpTools', at: pick.at, server: v })}
          onClose={() => setPick(null)}
        />
      )}
      {pick?.kind === 'mcpTools' && (
        <QuickPick
          anchor={pick.at}
          title={`Tool from ${pick.server}`}
          items={[{ value: '', label: 'Any tool', detail: 'Claude picks' }, ...(servers.find((m) => m.name === pick.server)?.tools ?? []).map((t) => ({ value: t.name, label: t.name, detail: t.description }))]}
          onPick={(v) => { setUses((u) => addUse(u, v ? { server: pick.server!, tool: v } : { server: pick.server! })); setPick(null); ta.current?.focus(); }}
          onClose={() => setPick(null)}
        />
      )}
      {pick?.kind === 'mode' && (
        <QuickPick
          anchor={pick.at}
          title="Permission mode"
          current={mode}
          items={PERMISSION_MODES.map((m) => ({ value: m, label: MODES[m]?.label ?? m, detail: MODES[m]?.detail }))}
          onPick={(v) => { send({ type: 'set_permission_mode', mode: v }); setPick(null); }}
          onClose={() => setPick(null)}
        />
      )}
    </div>
  );
}
