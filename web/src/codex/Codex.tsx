import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import { useAssistant, useCodex } from './data';
import { reviewCount } from './data/wiki';
import { ask, askText } from './data/ask';
import { atTime, errorText, reviewedSince, split } from './data/engine';
import type { Patch } from './data/store';
import { rowKey, type ItemRow } from './data/sync';
import { Icon } from '../ui/Icon';
import { ago } from '../ui/util';
import { FILTER_LABEL, hideSnack, setView, showSnack, useSnack, useSpotBack, useView, type Filter, type List } from './view';
import { Wiki } from './wiki/Wiki';
import { Jobs } from './jobs/Jobs';
import { Summary } from './summary/Summary';
import { Meetings } from './meetings/Meetings';
import { when } from './time';
import { Composer, prepText } from './AskBar';
import { AddTask, TaskRow, UNROLL, useActions } from './Task';
import { TaskEditor } from './TaskEditor';
import { Overview, Review } from './Overview';
import { useSplit } from './split';
import { AssistantNav, LISTS } from './nav';
import { useDrag, type Drop } from './drag';
import { Back } from '../app/back';
import { usePullRefresh, useScrolledHeader } from './usePullRefresh';
import { Skeleton } from '../ui/Skeleton';
import '../styles/features/assistant.css';


const DAY = 86400_000;

function greeting(h = new Date().getHours()) {
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function dayLabel(at: number) {
  const d = new Date(at);
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000);
  if (days === 1) return 'Tomorrow';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
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
// Rows keep the order they were dragged into; the rest follow by due time.
const ranked = (rs: ItemRow[]) => [...rs].sort((a, b) => (a.rank ?? 1e15) - (b.rank ?? 1e15) || (atTime(a.at) ?? 0) - (atTime(b.at) ?? 0));
// A day's tasks split by part of the day; tasks without a time come first.
const PARTS = ['Anytime', 'Morning', 'Afternoon', 'Evening'];
const partOf = (r: ItemRow) => { const at = atTime(r.at); if (at == null) return 0; const h = new Date(at).getHours(); return h < 12 ? 1 : h < 17 ? 2 : 3; };
const matches = (r: ItemRow, q: string) => [r.title, r.text, r.people].some((x) => x?.toLowerCase().includes(q));
const sameRow = (a: ItemRow, b: ItemRow) => a.profile === b.profile && a.id === b.id;

// The time on the new day keeps the time of day; a task with no time stays untimed today and gets 09:00 on another day.
function moveTo(r: ItemRow, day: number, today: number) {
  const at = atTime(r.at);
  if (at != null && new Date(at).setHours(0, 0, 0, 0) === day) return undefined;
  if (at == null) return day === today ? undefined : new Date(day).setHours(9, 0, 0, 0);
  const t = new Date(at);
  return new Date(day).setHours(t.getHours(), t.getMinutes(), 0, 0);
}

const CALENDAR_FRESH = 15 * 60_000;

function SpotBack({ scroller }: { scroller: React.RefObject<HTMLElement | null> }) {
  useSpotBack(scroller, 'tasks');
  return null;
}

export function Assistant() {
  const { store, snap } = useAssistant();
  const { list, filter, open } = useView();
  const s = useSplit();
  const root = useRef<HTMLDivElement>(null);
  const [drawer, setDrawer] = useState(false);
  const [olderOpen, setOlderOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const [calError, setCalError] = useState('');
  const [query, setQuery] = useState<string | null>(null);
  // / on Tasks opens the search when nothing else has focus.
  useEffect(() => {
    if (list !== 'tasks') return setQuery(null);
    const key = (e: KeyboardEvent) => {
      const at = document.activeElement;
      if (e.key !== '/' || e.metaKey || e.ctrlKey || root.current?.offsetParent == null || (at && at !== document.body && !at.matches('[data-row]'))) return;
      e.preventDefault();
      setQuery((q) => q ?? '');
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [list]);
  const scroller = useRef<HTMLDivElement>(null);
  const act = useActions();
  const { drag, start } = useDrag<ItemRow>((row, d) => dropRow(row, d), scroller);
  const view = list === 'today' || list === 'tasks';
  const ptr = usePullRefresh(scroller, () => store.syncNow(), view);
  useScrolledHeader(scroller, view);

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

  // An item moved to the other profile keeps its id, so the open task follows it.
  const current = list === 'tasks' && open ? snap.items.find((r) => rowKey(r) === open && !r.deleted) ?? snap.items.find((r) => r.id === open.slice(open.indexOf(':') + 1) && !r.deleted) : undefined;
  const close = useCallback(() => setView({ open: null }), []);
  const askAbout = (r: ItemRow) => ask(askText('Help me with this item.', snap.items, r));
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
      <Back close={() => setDrawer(false)} />
      <div className="as-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="as-drawer-title">Codex</div>
        <AssistantNav onPick={() => setDrawer(false)} />
      </div>
    </div>
  );

  if (current) {
    return (
      <div className="assistant wide" ref={root}>
        <TaskEditor key={rowKey(current)} row={current} onClose={close} onAsk={askAbout} />
        <SnackBar />
        {drawerSheet}
      </div>
    );
  }

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
  for (const d of days) d.rows = d.day == null ? ranked(d.rows) : ranked(d.rows).sort((a, b) => partOf(a) - partOf(b));
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
  const rows = (rs: ItemRow[], key?: string, droppable = true, parts = false) => {
    const over = key && droppable && drag?.over?.section === key ? drag.over.index : -1;
    const shown = rs.filter((r) => r.profile + r.id !== drag?.key);
    return (
      <div className="as-list" data-drop={droppable ? key : undefined}>
        {rs.map((r, i) => {
          const k = r.profile + r.id;
          const line = over >= 0 && shown[over] && shown[over].profile + shown[over].id === k;
          const part = parts && (i === 0 || partOf(rs[i - 1]) !== partOf(r)) && rs.filter((x) => partOf(x) === partOf(r)).length;
          return (
            <Fragment key={k}>
              {part && <div className="as-part">{PARTS[partOf(r)]} <span>{part}</span></div>}
              {line && <div className="as-drop-line" />}
              <TaskRow row={r} inDay={parts} onOpen={() => setView({ open: rowKey(r) })} onGrab={key ? start(r, k, r.title ?? '') : undefined} lifted={drag?.key === k} />
            </Fragment>
          );
        })}
        {over >= 0 && over >= shown.length && <div className="as-drop-line" />}
        {droppable && drag && !rs.length && <div className="as-drop-empty">Drop here</div>}
      </div>
    );
  };
  const section = (d: Day) => (d.rows.length > 0 || drag || d.key === 'today') && (
    <section key={d.key} className={drag?.over?.section === d.key && d.day != null ? 'as-target' : undefined}>
      <div className={`as-section${d.key === 'today' ? '' : ' later'}`}>{d.label} {d.rows.length > 0 && <span>{d.rows.length}</span>}</div>
      {rows(d.rows, d.key, d.day != null, d.day != null)}
      {d.day != null && !drag && <AddTask day={d.day} today={startOfDay} filter={filter} />}
    </section>
  );
  const fresh = s.review.filter((r) => now - reviewedSince(r) < DAY);
  const older = s.review.filter((r) => now - reviewedSince(r) >= DAY);
  const empty = !s.overdue.length && days.every((d) => !d.rows.length) && !s.review.length;
  const nextLater = s.nextLater;
  // Overdue tasks move to today at the same time of day, with one undo for all of them.
  const moveOverdue = () => {
    const moved = s.overdue.map((r) => ({ r, before: { at: r.at, rolls: r.rolls, rolled_from: r.rolled_from } as Patch, at: moveTo(r, startOfDay, startOfDay) }));
    for (const m of moved) if (m.at !== undefined) act.edit(m.r, { at: m.at, ...UNROLL });
    showSnack(`Moved ${moved.length} to Today`, () => moved.forEach((m) => act.edit(m.r, m.before)));
  };

  return (
    <div className={`assistant${list === 'tasks' ? ' tasks' : ''}`} ref={root}>
      <header className="as-head">
        <button className="icon-btn as-menu" title="Lists" aria-label="Lists" onClick={() => setDrawer(true)}><Icon name="menu" /></button>
        <div className="as-title-wrap">
          <h1>{heading}</h1>
        </div>
        {list === 'tasks' && query == null && <button className="icon-btn" title="Search tasks (/)" aria-label="Search tasks" onClick={() => setQuery('')}><Icon name="search" /></button>}
        {filter !== 'all' && <span className={`as-prof ${filter}`}>{FILTER_LABEL[filter]}</span>}
      </header>
      {sync.error && <button className="as-error" onClick={() => store.syncNow()}><Icon name="warning" small /> {status}. Your changes are kept on this device.</button>}
      {calError && <button className="as-error" onClick={() => store.syncCalendar().then(() => setCalError(''), (err) => setCalError(errorText(err)))}><Icon name="warning" small /> Calendar not updated: {calError}. Tap to retry.</button>}

      <div className="as-ptr" ref={ptr} aria-hidden><Icon name="refresh" /></div>
      <div className={`as-scroll${drag ? ' dragging' : ''}`} ref={scroller}>
        {list === 'today' && <Overview s={s} dueToday={dueToday} onPrep={() => ask(askText(prepText(s.next!), snap.items))} />}
        {list === 'tasks' && query != null && (
          <div className="as-search">
            <Icon name="search" />
            <input autoFocus value={query} placeholder="Search tasks" aria-label="Search tasks" enterKeyHint="search" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery(null)} />
            <button className="icon-btn" title="Close search" aria-label="Close search" onClick={() => setQuery(null)}><Icon name="close" /></button>
          </div>
        )}
        {list === 'tasks' && query?.trim() && (() => {
          const q = query.trim().toLowerCase();
          const seen = new Set<string>();
          const found = [...s.overdue, ...days.flatMap((d) => d.rows), ...s.review, ...s.doneToday].filter((r) => matches(r, q) && !seen.has(r.profile + r.id) && seen.add(r.profile + r.id));
          return (
            <section>
              <div className="as-section">Results <span>{found.length}</span></div>
              {found.length ? rows(found, undefined, false) : <div className="as-empty muted small">No task matches.</div>}
            </section>
          );
        })()}
        {list === 'tasks' && !query?.trim() && (
          <>
            {s.overdue.length > 0 && (
              <section>
                <div className="as-section late">Overdue <span>{s.overdue.length}</span><button className="as-section-btn" onClick={moveOverdue}>Move to today</button></div>
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
            {loading ? <Skeleton /> : empty && (
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
      {list === 'tasks' && <SpotBack scroller={scroller} />}

      {drag && <div className="as-ghost" style={{ transform: `translate(${drag.x}px, ${drag.y}px)` }}>{drag.title || '(Untitled)'}</div>}
      <SnackBar />
      <Composer items={snap.items} next={s.next} filter={filter} />
      {drawerSheet}
    </div>
  );
}
