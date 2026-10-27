import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import '@fontsource-variable/geist';
import { useAssistant, useCodex } from './data';
import { proposals } from './data/wiki';
import { ask, askText } from './data/ask';
import { atTime, errorText, nextNine, reviewedSince, split } from './data/engine';
import type { Patch } from './data/store';
import type { ItemRow } from './data/sync';
import { Icon } from '../ui/Icon';
import { ago } from '../ui/util';
import { FILTER_LABEL, hideSnack, setView, showSnack, useSnack, useView, type Filter, type List } from './view';
import { Wiki } from './wiki/Wiki';
import { Jobs } from './jobs/Jobs';
import { Summary } from './summary/Summary';
import { Meetings } from './meetings/Meetings';
import { PickTime, when } from './time';
import { Composer, prepText, snoozes } from './AskBar';
import { Overview, Review, useMinute, useSplit } from './Overview';
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
  const late = at != null ? Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / DAY) : 0;
  const due = at != null && !isNote && !isDone ? (late > 0 ? `${late}d late` : when(at, now)) : null;
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
            {row.rolled_from != null && !isDone && <span className="as-rolled">from {new Date(row.rolled_from).toLocaleDateString([], { weekday: 'short' })}</span>}
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
          <span className={`as-prof ${row.profile}`}>{FILTER_LABEL[row.profile]}</span>
          {at != null && <span>{row.status === 'open' ? 'due ' : ''}{when(at)}</span>}
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
            <button className="icon-btn" title="Delete" aria-label="Delete" onClick={then(() => act.remove(row))}><Icon name="trash" /></button>
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

export function AssistantNav({ onPick }: { onPick?: () => void }) {
  const { list, filter } = useView();
  const { store, snap } = useAssistant();
  const s = useSplit();
  const { facts } = useCodex();
  const count: Record<List, number> = { today: 0, tasks: s.overdue.length + s.today.length + s.later.filter((r) => atTime(r.at)! < s.endOfDay).length + s.review.length, summary: 0, meetings: 0, jobs: 0, wiki: proposals(facts).length };
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

  const current = open && snap.items.find((r) => r.profile === open.profile && r.id === open.id && !r.deleted);
  const { sync } = snap;
  const status = sync.error ? `Sync failed: ${sync.error}` : sync.last ? `Synced ${ago(sync.last, ' ago')}` : 'Syncing';
  const loading = sync.syncing && !sync.last && !snap.items.length;
  const heading = list === 'today' ? `${greeting()}, ${new Date().toLocaleDateString([], { weekday: 'short', day: 'numeric' })}` : LISTS.find((l) => l.id === list)!.label;
  const rows = (rs: ItemRow[]) => <div className="as-group">{rs.map((r) => <Row key={r.profile + r.id} row={r} onOpen={() => setOpen(r)} />)}</div>;

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
  const coming = s.later.filter((r) => atTime(r.at)! >= s.endOfDay).reduce<{ label: string; rows: ItemRow[] }[]>((acc, r) => {
    const at = atTime(r.at)!;
    const label = at >= horizon ? 'Later' : dayLabel(at);
    const last = acc[acc.length - 1];
    if (last?.label === label) last.rows.push(r);
    else acc.push({ label, rows: [r] });
    return acc;
  }, []);
  const fresh = s.review.filter((r) => now - reviewedSince(r) < DAY);
  const older = s.review.filter((r) => now - reviewedSince(r) >= DAY);
  const empty = !s.overdue.length && !dueToday.length && !coming.length && !s.review.length;
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

      <div className="as-scroll">
        {list === 'today' && <Overview s={s} dueToday={dueToday} onPrep={() => ask(askText(prepText(s.next!), snap.items))} />}
        {list === 'tasks' && (
          <>
            {s.overdue.length > 0 && (
              <section>
                <div className="as-section late">Overdue · {s.overdue.length}</div>
                {rows(s.overdue)}
              </section>
            )}
            <Review rows={fresh} />
            {older.length > 0 && (
              <section>
                <button className="as-section review as-toggle" onClick={() => setOlderOpen((v) => !v)}>{older.length} older to review <Icon name={olderOpen ? 'chevron-up' : 'chevron-down'} small /></button>
                {olderOpen && <Review rows={older} />}
              </section>
            )}
            {dueToday.length > 0 && (
              <section>
                <div className="as-section">Today · {dueToday.length}</div>
                {rows(dueToday)}
              </section>
            )}
            {coming.map((g) => (
              <section key={g.label}>
                <div className="as-section later">{g.label} · {g.rows.length}</div>
                {rows(g.rows)}
              </section>
            ))}
            {loading ? <div className="as-end">Loading</div> : empty && (
              <div className="as-empty">
                <Icon name="pass" />
                <div>All clear.</div>
                <div className="muted small">{nextLater ? `Next: ${when(nextLater.starts_at!)} ${nextLater.title}` : 'Type a task below, like “call the bank tomorrow 9”.'}</div>
              </div>
            )}
            {s.doneToday.length > 0 && (
              <section>
                <button className="as-section done as-toggle" onClick={() => setDoneOpen((v) => !v)}>Done today · {s.doneToday.length} <Icon name={doneOpen ? 'chevron-up' : 'chevron-down'} small /></button>
                {doneOpen && rows(s.doneToday)}
              </section>
            )}
          </>
        )}
      </div>

      <SnackBar />
      <Composer items={snap.items} next={s.next} filter={filter} />
      {current && <Sheet row={current} items={snap.items} onClose={() => setOpen(null)} />}
      {drawerSheet}
    </div>
  );
}
