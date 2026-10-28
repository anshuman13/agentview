import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import { useAssistant, useCodex } from './data';
import { reviewCount } from './data/wiki';
import { ask, askText } from './data/ask';
import { atTime, errorText, nextNine, reviewedSince, split } from './data/engine';
import type { Patch } from './data/store';
import type { ItemRow, Profile } from './data/sync';
import { Icon } from '../ui/Icon';
import { ago } from '../ui/util';
import { FILTER_LABEL, hideSnack, setView, showSnack, useSnack, useView, type Filter, type List } from './view';
import { Wiki } from './wiki/Wiki';
import { Jobs } from './jobs/Jobs';
import { Summary } from './summary/Summary';
import { Meetings } from './meetings/Meetings';
import { PickDue, PickTime, when } from './time';
import { Composer, prepText, snoozes } from './AskBar';
import { Overview, Review, useMinute, useSplit } from './Overview';
import { useDrag, isDragging, type Drop } from './drag';
import '../styles/features/assistant.css';

const LISTS: { id: List; icon: string; label: string }[] = [
  { id: 'today', icon: 'home', label: 'Overview' },
  { id: 'tasks', icon: 'checklist', label: 'Tasks' },
  { id: 'summary', icon: 'comment-discussion', label: 'Summary' },
  { id: 'meetings', icon: 'record', label: 'Meetings' },
  { id: 'jobs', icon: 'history', label: 'Jobs' },
  { id: 'wiki', icon: 'book', label: 'Wiki' },
];
const FILTERS: Filter[] = ['all', 'work', 'personal'];

const SOURCES: Record<string, { icon: string; label: string }> = {
  slack: { icon: 'comment-discussion', label: 'Slack' },
  linear: { icon: 'issues', label: 'Linear' },
  gmail: { icon: 'mail', label: 'Gmail' },
  mail: { icon: 'mail', label: 'Mail' },
  calendar: { icon: 'calendar', label: 'Calendar' },
  meeting: { icon: 'record', label: 'Meeting' },
  action: { icon: 'checklist', label: 'Meeting' },
  github: { icon: 'github', label: 'GitHub' },
  capture: { icon: 'edit', label: 'You' },
  job: { icon: 'history', label: 'Job' },
};
const sourceOf = (r: ItemRow) => SOURCES[r.source ?? 'capture'] ?? { icon: 'circle-small', label: r.source ?? '' };

const SWIPE = 80;
// A left swipe past this share of the row deletes instead of snoozing.
const SWIPE_DELETE = 0.55;
const DAY = 86400_000;

function greeting(h = new Date().getHours()) {
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function dayLabel(at: number) {
  const d = new Date(at);
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000);
  if (days === 1) return 'Tomorrow';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
}

const firstLine = (s: string | null) => s?.split('\n').find((l) => l.trim())?.trim() ?? '';

const UNROLL = { rolls: null, rolled_from: null };

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
    snooze: (r: ItemRow, at = nextNine()) => change(r, { at, ...UNROLL }, `Snoozed to ${when(at)}`),
    remove: (r: ItemRow) => change(r, { deleted: 1 }, 'Deleted'),
    toTask: (r: ItemRow) => change(r, { status: 'open', ...UNROLL }, 'Moved to Today'),
    due: (r: ItemRow, at: number | null) => change(r, { at, ...UNROLL }, at == null ? 'Due time cleared' : `Due ${when(at)}`),
    edit: (r: ItemRow, patch: Patch) => void store.update(r, patch),
    move: (r: ItemRow, to: Profile) => store.move(r, to).then(() => showSnack(`Moved to ${FILTER_LABEL[to]}`, () => {
      const moved = store.snapshot().items.find((x) => x.profile === to && x.id === r.id);
      void store.move(moved ?? { ...r, profile: to }, r.profile).catch((err) => showSnack(`Not moved: ${errorText(err)}`));
    }), (err) => showSnack(`Not moved: ${errorText(err)}`)),
  };
}

function Swipe({ onRight, onLeft, onDelete, children }: { onRight?: () => void; onLeft?: () => void; onDelete: () => void; children: React.ReactNode }) {
  const [dx, setDx] = useState(0);
  const width = useRef(1);
  const deleting = dx < 0 && (!onLeft || -dx > width.current * SWIPE_DELETE);
  const from = useRef<{ x: number; y: number } | null>(null);
  const moving = useRef(false);
  const swiped = useRef(false);
  const reset = () => { from.current = null; moving.current = false; setDx(0); };
  return (
    <div className={`as-swipe${dx > 0 ? ' right' : dx < 0 ? (deleting ? ' left delete' : ' left') : ''}`}>
      <div className="as-swipe-bg"><span><Icon name="check" /> Done</span>{deleting ? <span>Delete <Icon name="trash" /></span> : <span>Tomorrow <Icon name="clock" /></span>}</div>
      <div
        className="as-swipe-row"
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: moving.current ? 'none' : undefined }}
        onPointerDown={(e) => { if (e.pointerType !== 'mouse') { from.current = { x: e.clientX, y: e.clientY }; width.current = e.currentTarget.offsetWidth || 1; } }}
        onPointerMove={(e) => {
          if (!from.current) return;
          if (isDragging()) return reset();
          const mx = e.clientX - from.current.x;
          if (!moving.current) {
            if (Math.abs(e.clientY - from.current.y) > 10 && Math.abs(e.clientY - from.current.y) > Math.abs(mx)) { from.current = null; return; }
            if (Math.abs(mx) < 10) return;
            moving.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
          }
          setDx(mx > 0 ? (onRight ? mx : 0) : mx);
        }}
        onPointerUp={() => {
          if (moving.current) { swiped.current = true; setTimeout(() => { swiped.current = false; }, 0); }
          if (moving.current && dx > SWIPE) onRight?.();
          else if (moving.current && deleting && -dx > SWIPE) onDelete();
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

function Row({ row, onOpen, onGrab, lifted }: { row: ItemRow; onOpen: () => void; onGrab?: (e: React.PointerEvent) => void; lifted?: boolean }) {
  const act = useActions();
  const { filter } = useView();
  const [checked, setChecked] = useState(false);
  const src = sourceOf(row);
  const at = atTime(row.at);
  const now = Date.now();
  const isDone = row.status === 'done';
  const isNote = row.status === 'note';
  const late = at != null ? Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / DAY) : 0;
  const due = at != null && !isNote && !isDone ? (late > 0 ? `${late}d late` : when(at, now)) : null;
  const tick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDone) return act.reopen(row);
    setChecked(true);
    setTimeout(() => act.done(row), 260);
  };
  const body = (
    <div className={`as-row ${row.profile}${checked || isDone ? ' checked' : ''}${lifted ? ' lifted' : ''}`} data-row={row.profile + row.id} onPointerDown={onGrab} onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => e.target === e.currentTarget && e.key === 'Enter' && onOpen()}>
      {isNote ? (
        <span className="as-check note"><Icon name="note" /></span>
      ) : (
        <button className="as-check" title={isDone ? 'Not done' : 'Done'} aria-label={isDone ? 'Not done' : 'Done'} onClick={tick}>
          <Icon name={checked || isDone ? 'pass-filled' : 'circle-large-outline'} />
        </button>
      )}
      <div className="as-body">
        <div className="as-title">{row.title || '(Untitled)'}</div>
        <div className="as-ctx">
          {due && <span className={at! < now ? 'as-due late' : 'as-due'}>{due}</span>}
          {row.rolled_from != null && !isDone && <span>from {new Date(row.rolled_from).toLocaleDateString([], { weekday: 'short' })}</span>}
          {row.source && row.source !== 'capture' && <span className={`as-src ${row.source}`}><Icon name={src.icon} small /> {src.label}</span>}
          {row.people && <span className="as-people">{row.people}</span>}
          {isNote && row.text && <span className="as-quote">{firstLine(row.text)}</span>}
          {filter === 'all' && row.profile === 'personal' && <span className="as-prof personal">Personal</span>}
        </div>
      </div>
    </div>
  );
  if (isNote || isDone) return <Swipe onDelete={() => act.remove(row)}>{body}</Swipe>;
  return <Swipe onRight={() => act.done(row)} onLeft={() => act.snooze(row, nextNine(new Date(Math.max(at ?? 0, now))))} onDelete={() => act.remove(row)}>{body}</Swipe>;
}

function Sheet({ row, items, onClose }: { row: ItemRow; items: ItemRow[]; onClose: () => void }) {
  const act = useActions();
  const [title, setTitle] = useState(row.title ?? '');
  const [text, setText] = useState(row.text ?? '');
  const initial = useRef({ title: row.title ?? '', text: row.text ?? '' });
  const [snoozing, setSnoozing] = useState(false);
  const [tidying, setTidying] = useState(false);
  const { store } = useAssistant();
  const src = sourceOf(row);
  const fromSource = row.source && row.source !== 'capture' && row.source !== 'action';
  const at = atTime(row.at);
  const pending = () => {
    const patch: Patch = {};
    if (title.trim() && title !== initial.current.title) patch.title = title.trim();
    if (!fromSource && text !== initial.current.text) patch.text = text || null;
    return patch;
  };
  const save = () => {
    const patch = pending();
    if (Object.keys(patch).length) act.edit(row, patch);
  };
  const other: Profile = row.profile === 'work' ? 'personal' : 'work';
  // Unsaved title and details move with the item.
  const move = () => {
    const patch = pending();
    initial.current = { title, text };
    void act.move({ ...row, ...patch }, other);
  };
  const timed = row.status === 'open' || row.status === 'suggested' || at != null;
  const close = () => { save(); onClose(); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  const then = (f: () => void) => () => { save(); f(); onClose(); };
  // Haiku fixes a quick or dictated task into a clear title and details, and sets the time if the text says one.
  const tidy = async () => {
    setTidying(true);
    try {
      const p = await store.parse([title, text].filter((s) => s.trim()).join('\n'), row.profile);
      setTitle(p.title);
      setText(p.details ?? '');
      if (p.at != null && row.at == null) act.edit(row, { at: p.at });
    } catch (err) {
      showSnack(`Not tidied: ${(err as Error).message}`);
    } finally {
      setTidying(false);
    }
  };
  return (
    <div className="as-sheet-overlay" onClick={close}>
      <div className="as-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={row.title ?? 'Item'}>
        <div className="as-grip" />
        <input className="as-sheet-title" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
        <div className="as-ctx as-sheet-meta">
          <span><Icon name={src.icon} small /> {src.label}</span>
          {row.people && <span>{row.people}</span>}
          <span><button className={`as-meta-btn as-prof ${row.profile}`} title={`Move to ${FILTER_LABEL[other]}`} onClick={move}>{FILTER_LABEL[row.profile]}</button></span>
          {timed && (
            <span className="as-meta-due">
              <PickDue className={at == null ? 'as-meta-btn quiet' : 'as-meta-btn'} value={at} onPick={(t) => t !== at && act.due(row, t)}>
                {at == null ? <><Icon name="calendar" small /> Add due</> : `${row.status === 'open' ? 'due ' : ''}${when(at, Date.now(), true)}`}
              </PickDue>
              {at != null && <button className="as-meta-btn" title="Clear due time" aria-label="Clear due time" onClick={() => act.due(row, null)}><Icon name="close" small /></button>}
            </span>
          )}
          <span>{ago(row.updated_at, ' ago')}</span>
        </div>
        {fromSource ? (row.text && <blockquote className="as-sheet-quote">{row.text}</blockquote>) : (
          <textarea className="as-sheet-text" value={text} placeholder="Add details" onChange={(e) => setText(e.target.value)} />
        )}
        {row.meeting_id && <button className="as-sheet-link" onClick={then(() => setView({ list: 'meetings', open: `${row.profile}:${row.meeting_id}` }))}>Open the meeting <Icon name="arrow-right" small /></button>}
        {row.source_url && <a className="as-sheet-link" href={row.source_url} target="_blank" rel="noreferrer">{row.meeting_id ? 'Open the transcript' : `Open in ${src.label}`} <Icon name="link-external" small /></a>}
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
            {!fromSource && row.status === 'open' && <button className="btn" disabled={tidying} onClick={() => void tidy()}><Icon name={tidying ? 'loading' : 'wand'} small spin={tidying} /> Tidy</button>}
            <button className="btn" onClick={then(() => ask(askText('Help me with this item.', items, row)))}><Icon name="sparkle" small /> Ask</button>
            <span className="spacer" />
            <button className="btn as-delete" onClick={then(() => act.remove(row))}><Icon name="trash" small /> Delete</button>
          </div>
        )}
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

const UPCOMING_DAYS = 7;

type Day = { key: string; label: string; day: number | null; rows: ItemRow[] };
const ranked = (rs: ItemRow[]) => [...rs].sort((a, b) => (a.rank ?? 1e15) - (b.rank ?? 1e15));
const sameRow = (a: ItemRow, b: ItemRow) => a.profile === b.profile && a.id === b.id;

// The time on the new day keeps the time of day; a task with no time stays untimed today and gets 09:00 on another day.
function moveTo(r: ItemRow, day: number, today: number) {
  const at = atTime(r.at);
  if (at != null && new Date(at).setHours(0, 0, 0, 0) === day) return undefined;
  if (at == null) return day === today ? undefined : day + 9 * 3600_000;
  return day + (at - new Date(at).setHours(0, 0, 0, 0));
}

export function AssistantNav({ onPick }: { onPick?: () => void }) {
  const { list, filter } = useView();
  const { store, snap } = useAssistant();
  const s = useSplit();
  const { facts, pages } = useCodex();
  const count: Record<List, number> = { today: 0, tasks: s.overdue.length + s.today.length + s.later.filter((r) => atTime(r.at)! < s.endOfDay).length + s.review.length, summary: 0, meetings: 0, jobs: 0, wiki: reviewCount(pages, facts) };
  const { sync } = snap;
  const status = sync.error ? `Sync failed: ${sync.error}` : sync.last ? `Synced ${ago(sync.last, ' ago')}` : sync.syncing ? 'Syncing' : 'Not synced yet';
  const dot = sync.error ? 'bad' : sync.syncing ? 'busy' : sync.last ? 'ok' : 'off';
  return (
    <nav className="as-nav">
      {LISTS.map((l) => (
        <button key={l.id} className={list === l.id ? 'active' : ''} onClick={() => { setView({ list: l.id, open: null, anchor: null }); onPick?.(); }}>
          <Icon name={l.icon} /><span>{l.label}</span>{count[l.id] > 0 && <span className="as-count">{count[l.id]}</span>}
        </button>
      ))}
      <div className="as-nav-label">Show</div>
      <div className="as-seg" role="radiogroup" aria-label="Show work, personal or both">
        {FILTERS.map((f) => <button key={f} role="radio" aria-checked={filter === f} className={filter === f ? 'on' : ''} onClick={() => setView({ filter: f })}>{FILTER_LABEL[f]}</button>)}
      </div>
      <button className={`as-nav-sync ${dot}`} title="Sync now" onClick={() => store.syncNow()}><span className="as-dot" /><span>{status}</span></button>
    </nav>
  );
}

export function useTodayCount() {
  const { snap } = useAssistant();
  useMinute();
  if (snap.phase !== 'ready') return 0;
  const now = Date.now();
  const s = split(snap.items, 'all', now);
  const endOfDay = new Date(now).setHours(24, 0, 0, 0);
  return s.overdue.length + s.today.length + s.later.filter((r) => atTime(r.at)! < endOfDay).length + s.review.length;
}

const CALENDAR_FRESH = 15 * 60_000;

export function Assistant() {
  const { store, snap } = useAssistant();
  const { list, filter } = useView();
  const s = useSplit();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<ItemRow | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [olderOpen, setOlderOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const [calError, setCalError] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const act = useActions();
  const { drag, start } = useDrag<ItemRow>((row, d) => dropRow(row, d), scroller);

  useEffect(() => {
    const shown = () => document.visibilityState === 'visible' && root.current?.offsetParent != null;
    const retry = () => { if (shown()) store.unlock(); };
    retry();
    document.addEventListener('visibilitychange', retry);
    window.addEventListener('assistant:shown', retry);
    return () => { document.removeEventListener('visibilitychange', retry); window.removeEventListener('assistant:shown', retry); };
  }, [store]);

  // Opening the app imports the calendar unless the hub did within the last minutes.
  const ready = snap.phase === 'ready';
  useEffect(() => {
    if (!ready) return;
    const run = () => document.visibilityState === 'visible' && store.syncCalendar(CALENDAR_FRESH).then(() => setCalError(''), (err) => setCalError(errorText(err)));
    run();
    document.addEventListener('visibilitychange', run);
    return () => document.removeEventListener('visibilitychange', run);
  }, [store, ready]);

  // An item moved to the other profile keeps its id, so the open sheet follows it.
  const current = open && (snap.items.find((r) => r.profile === open.profile && r.id === open.id && !r.deleted) ?? snap.items.find((r) => r.id === open.id && !r.deleted));
  const { sync } = snap;
  const status = sync.error ? `Sync failed: ${sync.error}` : sync.last ? `Synced ${ago(sync.last, ' ago')}` : 'Syncing';
  const loading = sync.syncing && !sync.last && !snap.items.length;
  const heading = list === 'today' ? `${greeting()}, ${new Date().toLocaleDateString([], { weekday: 'short', day: 'numeric' })}` : LISTS.find((l) => l.id === list)!.label;

  if (!ready) {
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

  if (list !== 'today' && list !== 'tasks') {
    const Page = { wiki: Wiki, meetings: Meetings, jobs: Jobs, summary: Summary }[list];
    return (
      <div className="assistant wide" ref={root}>
        <Page onMenu={() => setDrawer(true)} />
        <SnackBar />
        {drawerSheet}
      </div>
    );
  }

  const now = Date.now();
  // Today holds everything due before midnight; later tasks follow by day, so a dated action never leaves the page.
  const horizon = new Date(now).setHours(24 * (UPCOMING_DAYS + 1), 0, 0, 0);
  const dueToday = [...s.today, ...s.later.filter((r) => atTime(r.at)! < s.endOfDay)];
  const startOfDay = new Date(now).setHours(0, 0, 0, 0);
  const days: Day[] = [{ key: 'today', label: 'Today', day: startOfDay, rows: ranked(dueToday) }];
  for (const r of s.later.filter((r) => atTime(r.at)! >= s.endOfDay)) {
    const at = atTime(r.at)!;
    const later = at >= horizon;
    const day = later ? null : new Date(at).setHours(0, 0, 0, 0);
    const key = later ? 'later' : String(day);
    const g = days.find((d) => d.key === key);
    if (g) g.rows.push(r);
    else days.push({ key, label: later ? 'Later' : dayLabel(at), day, rows: [r] });
  }
  for (const d of days) d.rows = ranked(d.rows);
  const tomorrow = new Date(now).setHours(24, 0, 0, 0);
  if (drag && !days.some((d) => d.day === tomorrow)) days.splice(1, 0, { key: String(tomorrow), label: 'Tomorrow', day: tomorrow, rows: [] });
  // Dropping sets the order of the day's rows and moves the task to that day.
  function dropRow(row: ItemRow, d: Drop) {
    const target = days.find((x) => x.key === d.section);
    if (!target || target.day == null) return;
    const order = target.rows.filter((r) => !sameRow(r, row));
    order.splice(d.index, 0, row);
    const at = moveTo(row, target.day, startOfDay);
    order.forEach((r, i) => {
      const patch: Patch = r.rank === i + 1 ? {} : { rank: i + 1 };
      if (sameRow(r, row) && at !== undefined) Object.assign(patch, { at }, UNROLL);
      if (Object.keys(patch).length) act.edit(r, patch);
    });
    if (at !== undefined) showSnack(`Moved to ${target.label}`, () => act.edit(row, { at: row.at, rank: row.rank, rolls: row.rolls, rolled_from: row.rolled_from }));
  }
  const rows = (rs: ItemRow[], key?: string, droppable = true) => {
    const over = key && droppable && drag?.over?.section === key ? drag.over.index : -1;
    const shown = rs.filter((r) => r.profile + r.id !== drag?.key);
    return (
      <div className="as-list" data-drop={droppable ? key : undefined}>
        {rs.map((r) => {
          const k = r.profile + r.id;
          const line = over >= 0 && shown[over] && shown[over].profile + shown[over].id === k;
          return (
            <Fragment key={k}>
              {line && <div className="as-drop-line" />}
              <Row row={r} onOpen={() => setOpen(r)} onGrab={key ? start(r, k, r.title ?? '') : undefined} lifted={drag?.key === k} />
            </Fragment>
          );
        })}
        {over >= 0 && over >= shown.length && <div className="as-drop-line" />}
        {droppable && drag && !rs.length && <div className="as-drop-empty">Drop here</div>}
      </div>
    );
  };
  const section = (d: Day) => (d.rows.length > 0 || drag) && (
    <section key={d.key} className={drag?.over?.section === d.key && d.day != null ? 'as-target' : undefined}>
      <div className={`as-section${d.key === 'today' ? '' : ' later'}`}>{d.label} {d.rows.length > 0 && <span>{d.rows.length}</span>}</div>
      {rows(d.rows, d.key, d.day != null)}
    </section>
  );
  const fresh = s.review.filter((r) => now - reviewedSince(r) < DAY);
  const older = s.review.filter((r) => now - reviewedSince(r) >= DAY);
  const empty = !s.overdue.length && days.every((d) => !d.rows.length) && !s.review.length;
  const nextLater = s.nextLater;

  return (
    <div className="assistant" ref={root}>
      <header className="as-head">
        <button className="icon-btn as-menu" title="Lists" aria-label="Lists" onClick={() => setDrawer(true)}><Icon name="menu" /></button>
        <div className="as-title-wrap">
          <h1>{heading}</h1>
        </div>
        {filter !== 'all' && <span className={`as-prof ${filter}`}>{FILTER_LABEL[filter]}</span>}
      </header>
      {sync.error && <button className="as-error" onClick={() => store.syncNow()}><Icon name="warning" small /> {status}. Your changes are kept on this device.</button>}
      {calError && <button className="as-error" onClick={() => store.syncCalendar().then(() => setCalError(''), (err) => setCalError(errorText(err)))}><Icon name="warning" small /> Calendar not updated: {calError}. Tap to retry.</button>}

      <div className={`as-scroll${drag ? ' dragging' : ''}`} ref={scroller}>
        {list === 'today' && <Overview s={s} dueToday={dueToday} onPrep={() => ask(askText(prepText(s.next!), snap.items))} />}
        {list === 'tasks' && (
          <>
            {s.overdue.length > 0 && (
              <section>
                <div className="as-section late">Overdue <span>{s.overdue.length}</span></div>
                {rows(s.overdue, 'overdue', false)}
              </section>
            )}
            {section(days[0])}
            <Review rows={fresh} />
            {older.length > 0 && (
              <section>
                <button className="as-section review as-toggle" onClick={() => setOlderOpen((v) => !v)}>Older to review <span>{older.length}</span> <Icon name={olderOpen ? 'chevron-up' : 'chevron-down'} small /></button>
                {olderOpen && <Review rows={older} />}
              </section>
            )}
            {days.slice(1).map(section)}
            {loading ? <div className="as-end">Loading</div> : empty && (
              <div className="as-empty">
                <Icon name="pass" />
                <div>All clear.</div>
                <div className="muted small">{nextLater ? `Next: ${when(nextLater.starts_at!)} ${nextLater.title}` : 'Type a task below, like “call the bank tomorrow 9”.'}</div>
              </div>
            )}
            {s.doneToday.length > 0 && (
              <section>
                <button className="as-section done as-toggle" onClick={() => setDoneOpen((v) => !v)}>Done today <span>{s.doneToday.length}</span> <Icon name={doneOpen ? 'chevron-up' : 'chevron-down'} small /></button>
                {doneOpen && rows(s.doneToday)}
              </section>
            )}
          </>
        )}
      </div>

      {drag && <div className="as-ghost" style={{ transform: `translate(${drag.x}px, ${drag.y}px)` }}>{drag.title || '(Untitled)'}</div>}
      <SnackBar />
      <Composer items={snap.items} next={s.next} filter={filter} />
      {current && <Sheet row={current} items={snap.items} onClose={() => setOpen(null)} />}
      {drawerSheet}
    </div>
  );
}
