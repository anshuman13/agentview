import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useAssistant, useCodex } from './data';
import { live, proposals, type Meeting } from './data/wiki';
import { ask, askText } from './data/ask';
import { SNOOZES, atTime, isQuestion, nextNine, parseWhen, split, stripWhen } from './data/engine';
import type { Patch } from './data/store';
import type { ItemRow, Profile } from './data/sync';
import { Icon } from '../ui/Icon';
import { touch } from '../app/touch';
import { Voice, useDictation } from '../chat/Voice';
import { ago, readFlag, saveFlag } from '../ui/util';
import { hideSnack, setView, showSnack, useSnack, useView, type Filter, type List } from './view';
import { Wiki } from './wiki/Wiki';
import { MeetingRow, Meetings } from './meetings/Meetings';
import '../styles/features/assistant.css';

type Mode = 'task' | 'note' | 'ask';

const LISTS: { id: List; icon: string; label: string }[] = [
  { id: 'today', icon: 'home', label: 'Today' },
  { id: 'upcoming', icon: 'calendar', label: 'Upcoming' },
  { id: 'meetings', icon: 'record', label: 'Meetings' },
  { id: 'wiki', icon: 'book', label: 'Wiki' },
  { id: 'notes', icon: 'note', label: 'Notes' },
  { id: 'done', icon: 'pass', label: 'Done' },
];
const SOON = [{ icon: 'history', label: 'Jobs' }, { icon: 'device-mobile', label: 'Devices' }];
const FILTERS: Filter[] = ['all', 'work', 'personal'];
const FILTER_LABEL: Record<Filter, string> = { all: 'All', work: 'Work', personal: 'Personal' };

const SOURCES: Record<string, { icon: string; label: string }> = {
  slack: { icon: 'comment-discussion', label: 'Slack' },
  linear: { icon: 'issues', label: 'Linear' },
  gmail: { icon: 'mail', label: 'Gmail' },
  mail: { icon: 'mail', label: 'Mail' },
  calendar: { icon: 'calendar', label: 'Calendar' },
  meeting: { icon: 'record', label: 'Meeting' },
  github: { icon: 'github', label: 'GitHub' },
  capture: { icon: 'edit', label: 'You' },
};
const sourceOf = (r: ItemRow) => SOURCES[r.source ?? 'capture'] ?? { icon: 'circle-small', label: r.source ?? '' };

const SWIPE = 80;
const QUICK = ['In 1 hour', 'Tonight', 'Tomorrow'];
const snoozes = (now = new Date()) => SNOOZES.filter((s) => s.label !== 'Tonight' || now.getHours() < 19);

function when(at: number, now = Date.now()) {
  const d = new Date(at);
  const today = new Date(now);
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (days === 0) return time;
  if (days === 1) return `tomorrow ${time}`;
  if (days === -1) return `yesterday ${time}`;
  if (days > 1 && days < 7) return `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function greeting(h = new Date().getHours()) {
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function dayLabel(at: number) {
  const d = new Date(at);
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000);
  if (days === 0) return 'Later today';
  if (days === 1) return 'Tomorrow';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
}

const firstLine = (s: string | null) => s?.split('\n').find((l) => l.trim())?.trim() ?? '';

function useActions() {
  const { store } = useAssistant();
  const change = (r: ItemRow, patch: Patch, text: string) => {
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, r[k as keyof ItemRow]])) as Patch;
    void store.update(r, patch);
    showSnack(text, () => void store.update(r, before));
  };
  return {
    done: (r: ItemRow) => change(r, { status: 'done' }, 'Done'),
    reopen: (r: ItemRow) => change(r, { status: 'open' }, 'Moved back to Today'),
    snooze: (r: ItemRow, at = nextNine()) => change(r, { at }, `Snoozed to ${when(at)}`),
    remove: (r: ItemRow) => change(r, { deleted: 1 }, 'Deleted'),
    toTask: (r: ItemRow) => change(r, { status: 'open' }, 'Moved to Today'),
    edit: (r: ItemRow, patch: Patch) => void store.update(r, patch),
  };
}

function Swipe({ onRight, onLeft, children }: { onRight: () => void; onLeft?: () => void; children: React.ReactNode }) {
  const [dx, setDx] = useState(0);
  const from = useRef<{ x: number; y: number } | null>(null);
  const moving = useRef(false);
  const swiped = useRef(false);
  const reset = () => { from.current = null; moving.current = false; setDx(0); };
  return (
    <div className={`as-swipe${dx > 0 ? ' right' : dx < 0 ? ' left' : ''}`}>
      <div className="as-swipe-bg"><span><Icon name="check" /> Done</span><span>Tomorrow <Icon name="clock" /></span></div>
      <div
        className="as-swipe-row"
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: moving.current ? 'none' : undefined }}
        onPointerDown={(e) => { if (e.pointerType !== 'mouse') from.current = { x: e.clientX, y: e.clientY }; }}
        onPointerMove={(e) => {
          if (!from.current) return;
          const mx = e.clientX - from.current.x;
          if (!moving.current) {
            if (Math.abs(e.clientY - from.current.y) > 10 && Math.abs(e.clientY - from.current.y) > Math.abs(mx)) { from.current = null; return; }
            if (Math.abs(mx) < 10) return;
            moving.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
          }
          setDx(onLeft || mx > 0 ? mx : 0);
        }}
        onPointerUp={() => {
          if (moving.current) { swiped.current = true; setTimeout(() => { swiped.current = false; }, 0); }
          if (moving.current && dx > SWIPE) onRight();
          else if (moving.current && dx < -SWIPE) onLeft?.();
          reset();
        }}
        onPointerCancel={reset}
        onClickCapture={(e) => { if (swiped.current) e.stopPropagation(); }}
      >
        {children}
      </div>
    </div>
  );
}

function Row({ row, onOpen }: { row: ItemRow; onOpen: () => void }) {
  const act = useActions();
  const [checked, setChecked] = useState(false);
  const src = sourceOf(row);
  const at = atTime(row.at);
  const now = Date.now();
  const isDone = row.status === 'done';
  const isNote = row.status === 'note';
  const quote = row.source !== 'capture' ? firstLine(row.text) : '';
  const due = at != null && !isNote && !isDone ? (at < now ? (now - at > 12 * 3600_000 ? `since ${when(at, now)}` : when(at, now)) : when(at, now)) : null;
  const tick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDone) return act.reopen(row);
    setChecked(true);
    setTimeout(() => act.done(row), 260);
  };
  const body = (
    <div className={`as-row ${row.profile}${checked || isDone ? ' checked' : ''}`} onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => e.target === e.currentTarget && e.key === 'Enter' && onOpen()}>
      <span className={`as-src ${isNote ? 'note' : row.source ?? 'capture'}`} title={src.label}><Icon name={isNote ? 'note' : src.icon} /></span>
      <div className="as-body">
        <div className="as-title">{row.title || '(Untitled)'}</div>
        {isNote && row.text ? (
          <div className="as-ctx"><span className="as-quote">{firstLine(row.text)}</span></div>
        ) : (
          <div className="as-ctx">
            {row.source && row.source !== 'capture' && <span>{src.label}</span>}
            {row.people && <span className="as-people">{row.people}</span>}
            {quote && <span className="as-quote">“{quote}”</span>}
            {due && <span className={at! < now ? 'as-due late' : 'as-due'}>{due}</span>}
            {!quote && !due && !row.people && <span>{ago(row.updated_at, ' ago')}</span>}
          </div>
        )}
      </div>
      {!isNote && (
        <button className="as-check" title={isDone ? 'Not done' : 'Done'} aria-label={isDone ? 'Not done' : 'Done'} onClick={tick}>
          <Icon name={checked || isDone ? 'pass-filled' : 'circle-large-outline'} />
        </button>
      )}
    </div>
  );
  if (isNote || isDone) return body;
  return <Swipe onRight={() => act.done(row)} onLeft={() => act.snooze(row, nextNine(new Date(Math.max(at ?? 0, now))))}>{body}</Swipe>;
}

function NextCard({ row, onOpen, onPrep }: { row: ItemRow; onOpen: () => void; onPrep: () => void }) {
  const at = atTime(row.at)!;
  const mins = Math.round((at - Date.now()) / 60000);
  return (
    <div className="as-next" onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => e.target === e.currentTarget && e.key === 'Enter' && onOpen()}>
      <div className="as-next-head"><Icon name="calendar" small /> {when(at)} <span className="muted">· {mins < 60 ? `in ${mins} min` : `in ${Math.round(mins / 60)} h`}</span></div>
      <div className="as-next-title">{row.title}</div>
      {row.people && <div className="as-ctx"><span>{row.people}</span></div>}
      <div className="as-next-actions">
        <button className="btn sm" onClick={(e) => { e.stopPropagation(); onPrep(); }}><Icon name="sparkle" small /> Prep</button>
        {row.source_url && <a className="btn sm" href={row.source_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Open</a>}
      </div>
    </div>
  );
}

function Sheet({ row, items, onClose }: { row: ItemRow; items: ItemRow[]; onClose: () => void }) {
  const act = useActions();
  const [title, setTitle] = useState(row.title ?? '');
  const [text, setText] = useState(row.text ?? '');
  const initial = useRef({ title: row.title ?? '', text: row.text ?? '' });
  const [snoozing, setSnoozing] = useState(false);
  const src = sourceOf(row);
  const fromSource = row.source && row.source !== 'capture';
  const at = atTime(row.at);
  const save = () => {
    const patch: Patch = {};
    if (title.trim() && title !== initial.current.title) patch.title = title.trim();
    if (!fromSource && text !== initial.current.text) patch.text = text || null;
    if (Object.keys(patch).length) act.edit(row, patch);
  };
  const close = () => { save(); onClose(); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  const then = (f: () => void) => () => { save(); f(); onClose(); };
  return (
    <div className="as-sheet-overlay" onClick={close}>
      <div className="as-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={row.title ?? 'Item'}>
        <div className="as-grip" />
        <input className="as-sheet-title" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
        <div className="as-ctx as-sheet-meta">
          <span><Icon name={src.icon} small /> {src.label}</span>
          {row.people && <span>{row.people}</span>}
          <span className={`as-prof ${row.profile}`}>{FILTER_LABEL[row.profile]}</span>
          {at != null && <span>{row.status === 'open' ? 'due ' : ''}{when(at)}</span>}
          <span>{ago(row.updated_at, ' ago')}</span>
        </div>
        {fromSource ? (row.text && <blockquote className="as-sheet-quote">{row.text}</blockquote>) : (
          <textarea className="as-sheet-text" value={text} placeholder="Add details" onChange={(e) => setText(e.target.value)} />
        )}
        {row.source_url && <a className="as-sheet-link" href={row.source_url} target="_blank" rel="noreferrer">Open in {src.label} <Icon name="link-external" small /></a>}
        {snoozing ? (
          <div className="as-sheet-actions">
            {snoozes().map((s) => <button key={s.label} className="btn" onClick={then(() => act.snooze(row, s.at(new Date())))}>{s.label}</button>)}
            <PickTime className="btn" value={at} onPick={(t) => then(() => act.snooze(row, t))()} />
            <button className="icon-btn" title="Back" onClick={() => setSnoozing(false)}><Icon name="close" /></button>
          </div>
        ) : (
          <div className="as-sheet-actions">
            {row.status === 'open' && <button className="btn primary" onClick={then(() => act.done(row))}><Icon name="check" small /> Done</button>}
            {row.status === 'done' && <button className="btn" onClick={then(() => act.reopen(row))}>Not done</button>}
            {row.status === 'note' && <button className="btn" onClick={then(() => act.toTask(row))}>Make task</button>}
            {row.status === 'open' && <button className="btn" onClick={() => setSnoozing(true)}><Icon name="clock" small /> Snooze</button>}
            <button className="btn" onClick={then(() => ask(askText('Help me with this item.', items, row)))}><Icon name="sparkle" small /> Ask</button>
            <span className="spacer" />
            <button className="icon-btn" title="Delete" aria-label="Delete" onClick={then(() => act.remove(row))}><Icon name="trash" /></button>
          </div>
        )}
      </div>
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
const localInput = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

// A button that opens the system date and time picker.
function PickTime({ className, value, onPick }: { className: string; value?: number | null; onPick: (at: number) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  // React's onChange fires on every input event; the native change event fires once the picker is confirmed.
  useEffect(() => {
    const el = input.current!;
    const change = () => { const t = new Date(el.value).getTime(); if (Number.isFinite(t)) pick.current(t); };
    el.addEventListener('change', change);
    return () => el.removeEventListener('change', change);
  }, []);
  const open = () => {
    const el = input.current;
    if (!el) return;
    el.value = localInput(value ?? SNOOZES[0].at(new Date()));
    try { el.showPicker(); } catch { el.focus(); el.click(); }
  };
  return (
    <span className="as-pick">
      <button className={className} onClick={open}><Icon name="calendar" small /> Pick time</button>
      <input ref={input} type="datetime-local" tabIndex={-1} aria-hidden />
    </span>
  );
}

const marked = (text: string, spans: [number, number][]) => {
  const out: React.ReactNode[] = [];
  let i = 0;
  for (const [s, e] of spans) {
    if (s < i) continue;
    out.push(text.slice(i, s), <mark key={s}>{text.slice(s, e)}</mark>);
    i = e;
  }
  out.push(text.slice(i));
  return out;
};

const recipes = (next: ItemRow | undefined) => {
  const h = new Date().getHours();
  const list = [
    h < 12 ? { label: 'Plan my day', q: 'Plan my day. Use my calendar for today and my open items, suggest an order with times and point out conflicts.' }
      : h < 17 ? { label: "What's next", q: 'What should I do next? Use my calendar and my open items.' }
      : { label: 'Wrap up my day', q: 'Wrap up my day: what got done, what is still open, and what should move to tomorrow.' },
    { label: 'Missed in Slack', q: 'What did I miss in Slack today? List the threads and messages that need me, with links.' },
  ];
  if (next) list.unshift({ label: 'Prep next meeting', q: `Prepare me for "${next.title}" at ${when(atTime(next.at)!)}: who is in it, related Slack threads, Linear issues and docs.` });
  return list;
};

function Composer({ items, next, filter }: { items: ItemRow[]; next?: ItemRow; filter: Filter }) {
  const { store } = useAssistant();
  const [text, setText] = useState('');
  const [mode, setMode] = useState<Mode | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [noWhen, setNoWhen] = useState(false);
  const [pick, setPick] = useState<number | null>(null);
  const [fresh, setFresh] = useState(false);
  const [voice, setVoice] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const dictate = useDictation(text, setText);

  useEffect(() => {
    const focus = () => area.current?.focus();
    const talk = () => setVoice(Date.now());
    window.addEventListener('assistant:focus', focus);
    window.addEventListener('assistant:voice', talk);
    return () => { window.removeEventListener('assistant:focus', focus); window.removeEventListener('assistant:voice', talk); };
  }, []);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const typed = text.trim();
  const m: Mode = mode ?? (isQuestion(typed) ? 'ask' : 'task');
  const prof: Profile = profile ?? (filter !== 'all' ? filter : readFlag('assistant-personal', false) ? 'personal' : 'work');
  const w = m === 'task' && !noWhen ? parseWhen(text) : null;
  const due = m === 'task' ? pick ?? w?.at ?? null : null;
  const dated = pick != null || w != null;

  const reset = () => { setText(''); setMode(null); setNoWhen(false); setPick(null); setFresh(false); setProfile(null); };
  const busy = useRef(false);
  const submit = async () => {
    if (!typed || busy.current) return;
    if (m === 'ask') {
      if (ask(askText(typed, items), fresh)) reset();
      return;
    }
    busy.current = true;
    try {
      const title = m === 'task' ? stripWhen(text, w) || typed : typed;
      const row = await store.capture(title, m, prof, due);
      saveFlag('assistant-personal', prof === 'personal');
      reset();
      showSnack(m === 'note' ? 'Note saved' : due != null ? `Added for ${when(due)}` : 'Added to Today', () => void store.update(row, { deleted: 1 }));
    } catch (err) {
      showSnack(`Not saved: ${(err as Error).message}`);
    } finally {
      busy.current = false;
    }
  };
  const cycle = () => setMode((x) => ((x ?? m) === 'task' ? 'note' : (x ?? m) === 'note' ? 'ask' : 'task'));
  const MODE: Record<Mode, { icon: string; label: string }> = { task: { icon: 'pass', label: 'Task' }, note: { icon: 'note', label: 'Note' }, ask: { icon: 'sparkle', label: 'Ask Claude' } };

  return (
    <div className="as-composer">
      <div className="as-chips" onPointerDown={(e) => { if ((e.target as HTMLElement).closest('button') && document.activeElement === area.current) e.preventDefault(); }}>
        {typed ? (
          <>
            <button className="as-chip on" title="Task, note or a question for Claude" onClick={cycle}><Icon name={MODE[m].icon} small /> {MODE[m].label}</button>
            {m === 'ask' && <button className={`as-chip${fresh ? ' on' : ''}`} title="Ask in today's Codex chat or start a new one" onClick={() => setFresh((f) => !f)}><Icon name={fresh ? 'add' : 'comment-discussion'} small /> {fresh ? 'New chat' : "Today's chat"}</button>}
            {m !== 'ask' && <button className={`as-chip ${prof}`} title="Work or personal" onClick={() => setProfile(prof === 'work' ? 'personal' : 'work')}>{FILTER_LABEL[prof]}</button>}
            {m === 'task' && (dated ? (
              <button className="as-chip when on" title="Remove the time" onClick={() => { setPick(null); setNoWhen(true); }}><Icon name="clock" small /> {due != null ? when(due) : 'Today'} <Icon name="close" small /></button>
            ) : (
              <>
                {snoozes().filter((s) => QUICK.includes(s.label)).map((s) => <button key={s.label} className="as-chip time" onClick={() => setPick(s.at(new Date()))}><Icon name="clock" small /> {s.label}</button>)}
                <PickTime className="as-chip time" onPick={setPick} />
              </>
            ))}
          </>
        ) : (
          recipes(next).map((r) => <button key={r.label} className="as-chip" onClick={() => ask(askText(r.q, items))}><Icon name="sparkle" small /> {r.label}</button>)
        )}
      </div>
      <div className="cp-card as-card">
        <div className="as-input">
          {w && pick == null && <div className="as-mirror" aria-hidden>{marked(text, w.spans)}</div>}
          <textarea
            ref={area}
            rows={1}
            value={text}
            placeholder="Add a task or ask anything"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && (!touch() || e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); } }}
          />
        </div>
        <div className="cp-foot">
          <span className="cp-spacer" />
          <Voice onText={dictate} autoStart={voice} />
          <button className="cp-send" onPointerDown={(e) => e.preventDefault()} title={m === 'ask' ? (fresh ? 'Ask Claude in a new chat' : "Ask Claude in today's Codex chat") : 'Save'} aria-label="Send" disabled={!typed} onClick={() => void submit()}>
            <Icon name="arrow-up" />
          </button>
        </div>
      </div>
    </div>
  );
}

function SnackBar() {
  const s = useSnack();
  if (!s) return null;
  return (
    <div className="as-snack" key={s.id}>
      <span>{s.text}</span>
      {s.undo && <button onClick={() => { s.undo!(); hideSnack(); }}>Undo</button>}
    </div>
  );
}

// Re-renders every minute and when the app comes back to the front, so due tasks move into Today.
function useMinute() {
  const [minute, tick] = useState(0);
  useEffect(() => {
    const bump = () => tick((n) => n + 1);
    const t = setInterval(bump, 60000);
    const shown = () => document.visibilityState === 'visible' && bump();
    document.addEventListener('visibilitychange', shown);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', shown); };
  }, []);
  return minute;
}

function useSplit() {
  const { snap } = useAssistant();
  const { meetings } = useCodex();
  const { filter } = useView();
  const minute = useMinute();
  return useMemo(() => {
    const now = Date.now();
    const mine = live(meetings).filter((m) => m.starts_at != null && (m.ends_at ?? m.starts_at) > now && (filter === 'all' || m.profile === filter)).sort((a, b) => a.starts_at! - b.starts_at!);
    const endOfDay = new Date(now).setHours(24, 0, 0, 0);
    return { ...split(snap.items, filter, now), meetingsToday: mine.filter((m) => m.starts_at! < endOfDay), meetingsLater: mine.filter((m) => m.starts_at! >= endOfDay) };
  }, [snap.items, meetings, filter, minute]);
}

export function AssistantNav({ onPick }: { onPick?: () => void }) {
  const { list } = useView();
  const s = useSplit();
  const { facts } = useCodex();
  const count: Record<List, number> = { today: s.today.length + s.next.length, upcoming: s.later.length + s.meetingsLater.length, meetings: 0, wiki: proposals(facts).length, notes: s.notes.length, done: 0 };
  return (
    <nav className="as-nav">
      {LISTS.map((l) => (
        <button key={l.id} className={list === l.id ? 'active' : ''} onClick={() => { setView({ list: l.id, open: null, anchor: null }); onPick?.(); }}>
          <Icon name={l.icon} /><span>{l.label}</span>{count[l.id] > 0 && <span className="as-count">{count[l.id]}</span>}
        </button>
      ))}
      <div className="as-nav-label">Coming next</div>
      {SOON.map((l) => <div key={l.label} className="as-nav-soon"><Icon name={l.icon} /><span>{l.label}</span></div>)}
    </nav>
  );
}

export function useTodayCount() {
  const { snap } = useAssistant();
  useMinute();
  return snap.phase === 'ready' ? split(snap.items, 'all', Date.now()).today.length : 0;
}

export function Assistant() {
  const { store, snap } = useAssistant();
  const { list, filter } = useView();
  const s = useSplit();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<ItemRow | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [showLater, setShowLater] = useState(false);

  useEffect(() => {
    const shown = () => document.visibilityState === 'visible' && root.current?.offsetParent != null;
    const retry = () => { if (shown()) store.unlock(); };
    retry();
    document.addEventListener('visibilitychange', retry);
    window.addEventListener('assistant:shown', retry);
    return () => { document.removeEventListener('visibilitychange', retry); window.removeEventListener('assistant:shown', retry); };
  }, [store]);

  const current = open && snap.items.find((r) => r.profile === open.profile && r.id === open.id && !r.deleted);
  const { sync } = snap;
  const status = sync.error ? `Sync failed: ${sync.error}` : sync.last ? `Synced ${ago(sync.last, ' ago')}` : sync.syncing ? 'Syncing' : 'Not synced yet';
  const dot = sync.error ? 'bad' : sync.syncing ? 'busy' : sync.last ? 'ok' : 'off';
  const loading = sync.syncing && !sync.last && !snap.items.length;
  const heading = list === 'today' ? `Today, ${new Date().toLocaleDateString([], { weekday: 'short', day: 'numeric' })}` : LISTS.find((l) => l.id === list)!.label;
  const rows = (rs: ItemRow[]) => <div className="as-group">{rs.map((r) => <Row key={r.profile + r.id} row={r} onOpen={() => setOpen(r)} />)}</div>;

  if (snap.phase !== 'ready') {
    return (
      <div className="assistant locked" ref={root}>
        <Icon name="lock" />
        <div className="as-lock-title">Codex is locked</div>
        <div className="muted">{snap.message === 'Locked' ? 'Your tasks and notes are encrypted on this phone.' : snap.message}</div>
        {snap.phase === 'locked' && <button className="btn primary lg" onClick={() => store.unlock()}>{snap.message === 'Locked' ? 'Unlock' : 'Retry'}</button>}
      </div>
    );
  }

  const drawerSheet = drawer && (
    <div className="as-drawer-overlay" onClick={() => setDrawer(false)}>
      <div className="as-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="as-drawer-title">Codex</div>
        <AssistantNav onPick={() => setDrawer(false)} />
      </div>
    </div>
  );

  if (list === 'wiki' || list === 'meetings') {
    return (
      <div className="assistant wide" ref={root}>
        {list === 'wiki' ? <Wiki onMenu={() => setDrawer(true)} /> : <Meetings onMenu={() => setDrawer(true)} />}
        <SnackBar />
        {drawerSheet}
      </div>
    );
  }

  const dated: ({ at: number; row: ItemRow } | { at: number; meeting: Meeting })[] = [
    ...s.later.map((row) => ({ at: atTime(row.at)!, row })),
    ...s.meetingsLater.map((meeting) => ({ at: meeting.starts_at!, meeting })),
  ].sort((a, b) => a.at - b.at);
  const upcoming = dated.reduce<{ label: string; rows: typeof dated }[]>((acc, e) => {
    const label = dayLabel(e.at);
    const last = acc[acc.length - 1];
    if (last?.label === label) last.rows.push(e);
    else acc.push({ label, rows: [e] });
    return acc;
  }, []);
  const now = Date.now();

  return (
    <div className="assistant" ref={root}>
      <header className="as-head">
        <button className="icon-btn as-menu" title="Lists" aria-label="Lists" onClick={() => setDrawer(true)}><Icon name="menu" /></button>
        <div className="as-title-wrap">
          {list === 'today' && <div className="as-greet">{greeting()}</div>}
          <h1>{heading}</h1>
        </div>
        <button className="as-filter" title="Show work, personal or both" onClick={() => setView({ filter: FILTERS[(FILTERS.indexOf(filter) + 1) % FILTERS.length] })}>
          {FILTER_LABEL[filter]} <Icon name="chevron-down" small />
        </button>
        <button className={`as-sync ${dot}`} title={`${status}. Sync now`} aria-label="Sync now" onClick={() => store.syncNow()}><span /></button>
      </header>
      {sync.error && <button className="as-error" onClick={() => store.syncNow()}><Icon name="warning" small /> {status}. Your changes are kept on this device.</button>}

      <div className="as-scroll">
        {list === 'today' && (
          <>
            {s.next[0] && (
              <section>
                <div className="as-section">Next</div>
                <NextCard row={s.next[0]} onOpen={() => setOpen(s.next[0])} onPrep={() => ask(askText(recipes(s.next[0])[0].q, snap.items))} />
              </section>
            )}
            {s.meetingsToday.length > 0 && (
              <section>
                <div className="as-section">Meetings · {s.meetingsToday.length}</div>
                <div className="as-group">{s.meetingsToday.map((m) => <MeetingRow key={m.profile + m.id} m={m} now={now} />)}</div>
              </section>
            )}
            {s.today.length > 0 && (
              <section>
                <div className="as-section">Needs you · {s.today.length}</div>
                {rows(s.today)}
              </section>
            )}
            {s.later.length > 0 && (
              <section>
                <button className="as-section as-toggle" onClick={() => setShowLater((v) => !v)}>Later · {s.later.length} <Icon name={showLater ? 'chevron-up' : 'chevron-down'} small /></button>
                {showLater && rows(s.later)}
              </section>
            )}
            {loading ? <div className="as-end">Loading</div> : s.today.length || s.next.length ? <div className="as-end">That's all for now.</div> : (
              <div className="as-empty">
                <Icon name="pass" />
                <div>Nothing needs you right now.</div>
                <div className="muted small">Type a task below, like “call the bank tomorrow 9”.</div>
              </div>
            )}
          </>
        )}
        {list === 'upcoming' && (upcoming.length ? upcoming.map((g) => (
          <section key={g.label}><div className="as-section">{g.label}</div><div className="as-group">{g.rows.map((e) => ('meeting' in e ? <MeetingRow key={e.meeting.profile + e.meeting.id} m={e.meeting} now={now} /> : <Row key={e.row.profile + e.row.id} row={e.row} onOpen={() => setOpen(e.row)} />))}</div></section>
        )) : <div className="as-empty"><Icon name="calendar" /><div>Nothing scheduled.</div><div className="muted small">Meetings, snoozed tasks and tasks with a date show here.</div></div>)}
        {list === 'notes' && (s.notes.length ? <section>{rows(s.notes)}</section> : <div className="as-empty"><Icon name="note" /><div>No notes yet.</div><div className="muted small">Type below and tap Task to switch to Note.</div></div>)}
        {list === 'done' && (s.done.length ? <section><div className="as-section">Last 7 days</div>{rows(s.done)}</section> : <div className="as-empty"><Icon name="pass" /><div>Nothing done this week yet.</div></div>)}
      </div>

      <SnackBar />
      <Composer items={snap.items} next={s.next[0]} filter={filter} />
      {current && <Sheet row={current} items={snap.items} onClose={() => setOpen(null)} />}
      {drawerSheet}
    </div>
  );
}
