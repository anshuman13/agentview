import { Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import { codexMeetings, useAssistant, useCodex, useSyncGate } from './data';
import { reviewCount } from './data/wiki';
import { ask, askText } from './data/ask';
import { atTime, reviewedSince, split } from './data/engine';
import { taskMatches } from './data/match';
import { dayLabel, greeting, moveTo } from './days';
import { SnackBar } from './SnackBar';
import { useHubLifecycle } from './useHubLifecycle';
import type { Patch } from './data/store';
import { rowKey, type ItemRow } from './data/sync';
import type { BulkKind } from './useActions';
import { Icon } from '../ui/Icon';
import { EmptyState } from '../ui/Panel';
import { Button } from '../ui/Button';
import { Section, sectionCount } from '../ui/Section';
import { haptic } from '../ui/haptic';
import { FILTER_LABEL, searchRun, setView, showSnack, useSpotBack, useView, type Filter, type List } from './view';
import { when } from './time';
import { Composer, prepText } from './AskBar';
import { AddSheet } from './AddSheet';
import { TagPage } from './TagPage';
import { UNROLL, useActions } from './Task';
import { DayGroup, TaskList, type Day } from './TaskGroup';
import { Overview, Review } from './Overview';
import { useSplit } from './split';
import { AssistantNav, LISTS } from './nav';
import { isDragging, useDrag, type Drop } from './drag';
import { Back } from '../app/back';
import { usePullRefresh, useScrolledHeader } from './usePullRefresh';
import { Skeleton } from '../ui/Skeleton';
import { prefetch } from '../app/lazy';
import '../styles/features/assistant.css';
import '../styles/features/overview.css';

const TaskEditor = prefetch(() => import('./TaskEditor').then((m) => m.TaskEditor));
const Wiki = prefetch(() => import('./wiki/Wiki').then((m) => m.Wiki));
const Jobs = prefetch(() => import('./jobs/Jobs').then((m) => m.Jobs));
const Summary = prefetch(() => import('./summary/Summary').then((m) => m.Summary));
const GoalsPage = prefetch(() => import('./GoalsPage').then((m) => m.GoalsPage));
const Search = prefetch(() => import('./Search').then((m) => m.Search));
const Meetings = prefetch(() => import('./meetings/Meetings').then((m) => m.Meetings));

const DAY = 86400_000;

const UPCOMING_DAYS = 7;

// Rows keep the order they were dragged into; the rest follow by due time.
const ranked = (rs: ItemRow[]) => [...rs].sort((a, b) => (a.rank ?? 1e15) - (b.rank ?? 1e15) || (atTime(a.at) ?? 0) - (atTime(b.at) ?? 0));
// A day's tasks sort by part of the day; tasks without a time come first.
const partOf = (r: ItemRow) => { const at = atTime(r.at); if (at == null) return 0; const h = new Date(at).getHours(); return h < 12 ? 1 : h < 17 ? 2 : 3; };
const sameRow = (a: ItemRow, b: ItemRow) => a.profile === b.profile && a.id === b.id;
const pickable = (r: ItemRow) => !r.deleted && (r.status === 'open' || r.status === 'suggested');

function SpotBack({ scroller }: { scroller: React.RefObject<HTMLElement | null> }) {
  useSpotBack(scroller, 'tasks');
  return null;
}

export function Assistant() {
  const { store, snap } = useAssistant();
  const { list, filter, open, tag } = useView();
  const s = useSplit();
  const root = useRef<HTMLDivElement>(null);
  const [drawer, setDrawer] = useState(false);
  const [adding, setAdding] = useState<boolean | number>(false);
  const [olderOpen, setOlderOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
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
  // Selection mode: the keys of the chosen tasks, or null when off.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  useEffect(() => setPicked(null), [list, filter, query != null]);
  useEffect(() => {
    if (!picked) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setPicked(null);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [!!picked]);
  // The n key and the palette open the add sheet, except during a drag or selection.
  useEffect(() => {
    if (list !== 'tasks') return;
    const add = () => { if (!isDragging() && !picked) setAdding(true); };
    window.addEventListener('tasks:add', add);
    return () => window.removeEventListener('tasks:add', add);
  }, [list, !!picked]);
  useEffect(() => {
    const live = new Set(snap.items.filter(pickable).map((r) => r.profile + r.id));
    setPicked((p) => (p && [...p].some((k) => !live.has(k)) ? new Set([...p].filter((k) => live.has(k))) : p));
  }, [snap.items]);
  const scroller = useRef<HTMLDivElement>(null);
  const act = useActions();
  const { drag, start } = useDrag<ItemRow>((row, d) => dropRow(row, d), scroller, 'row', (row) => {
    if (!pickable(row)) return;
    haptic('tap');
    setPicked(new Set([row.profile + row.id]));
  });
  const view = list === 'today' || list === 'tasks';
  const ptr = usePullRefresh(scroller, () => store.syncNow(), view);
  useScrolledHeader(scroller, view);

  const ready = snap.phase === 'ready';
  const { calError, retryCalendar } = useHubLifecycle(store, ready, root);

  // An item moved to the other profile keeps its id, so the open task follows it.
  const current = list === 'tasks' && open ? snap.items.find((r) => rowKey(r) === open && !r.deleted) ?? snap.items.find((r) => r.id === open.slice(open.indexOf(':') + 1) && !r.deleted) : undefined;
  const close = useCallback(() => setView({ open: null }), []);
  const askAbout = (r: ItemRow) => ask(askText('Help me with this item.', r.profile, snap.items, r, codexMeetings(snap.meetings)), r.profile);
  const gate = useSyncGate();
  const loading = gate.loading && !snap.items.length;
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
        <Suspense fallback={<Skeleton />}>
          <TaskEditor key={rowKey(current)} row={current} onClose={close} onAsk={askAbout} />
        </Suspense>
        <SnackBar />
        {drawerSheet}
      </div>
    );
  }

  if (list === 'tasks' && tag) return <TagPage tag={tag} />;

  if (list !== 'today' && list !== 'tasks') {
    const Page = { wiki: Wiki, meetings: Meetings, jobs: Jobs, summary: Summary, goals: GoalsPage, search: Search }[list];
    return (
      <div className="assistant wide" ref={root}>
        <Suspense fallback={<Skeleton />}><Page key={list === 'search' ? searchRun() : list} onMenu={() => setDrawer(true)} /></Suspense>
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
  const toggle = (k: string) => setPicked((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const chosen = picked ? snap.items.filter((r) => pickable(r) && picked.has(r.profile + r.id)) : [];
  const bulk = (kind: BulkKind) => { act.bulk(chosen, kind); setPicked(null); };
  const openRow = (r: ItemRow) => picked ? pickable(r) && toggle(r.profile + r.id) : setView({ open: rowKey(r) });
  const rows = (rs: ItemRow[], key?: string, droppable = true) => <TaskList rows={rs} sectionKey={key} droppable={droppable} drag={drag} picked={picked} onOpen={openRow} start={start} />;
  const section = (d: Day) => <DayGroup key={d.key} d={d} drag={drag} picked={picked} onOpen={openRow} start={start} />;
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
      <div className="tasks-head">
        <button className="icon-btn as-menu" title="Lists" aria-label="Lists" onClick={() => setDrawer(true)}><Icon name="menu" /></button>
        <Section
          label={<span role="heading" aria-level={1}>{heading}</span>}
          action={<>
            {list === 'tasks' && query == null && !picked && <button className="icon-btn" title="Select tasks" aria-label="Select tasks" onClick={() => setPicked(new Set())}><Icon name="tasklist" /></button>}
            {list === 'tasks' && query == null && <button className="icon-btn" title="Search tasks (/)" aria-label="Search tasks" onClick={() => setQuery('')}><Icon name="search" /></button>}
            {filter !== 'all' && <span className="muted">{FILTER_LABEL[filter]}</span>}
          </>}
        />
      </div>
      {gate.error && <button className="as-error" onClick={() => store.syncNow()}><Icon name="warning" small /> Sync failed: {gate.error}. Your changes are kept on this device.</button>}
      {calError && <button className="as-error" onClick={() => void retryCalendar()}><Icon name="warning" small /> Calendar not updated: {calError}. Tap to retry.</button>}

      <div className="as-ptr" ref={ptr} aria-hidden><Icon name="refresh" /></div>
      <div className={`as-scroll${drag ? ' dragging' : ''}`} ref={scroller}>
        {list === 'today' && <Overview s={s} dueToday={dueToday} onPrep={() => ask(askText(prepText(s.next!), s.next!.profile, snap.items, undefined, codexMeetings(snap.meetings)), s.next!.profile)} />}
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
          const found = [...s.overdue, ...days.flatMap((d) => d.rows), ...s.review, ...s.doneToday].filter((r) => taskMatches(r, q) && !seen.has(r.profile + r.id) && seen.add(r.profile + r.id));
          return (
            <section className="as-results">
              <Section label="Results" count={found.length} />
              {found.length ? rows(found, undefined, false) : <EmptyState size="sm" title="No task matches" />}
            </section>
          );
        })()}
        {list === 'tasks' && !query?.trim() && (
          <>
            {s.overdue.length > 0 && (
              <section>
                <Section label="Overdue" count={s.overdue.length} action={!picked && <Button variant="quiet" size="sm" onClick={moveOverdue}>Move all to today</Button>} />
                {rows(s.overdue, 'overdue', false)}
              </section>
            )}
            {section(days[0])}
            <Review rows={fresh} />
            {older.length > 0 && (
              <section>
                <Section label="Older to review" count={older.length} open={olderOpen} onToggle={() => setOlderOpen((v) => !v)} />
                {olderOpen && <Review rows={older} />}
              </section>
            )}
            {days.slice(1).map(section)}
            {loading ? <Skeleton /> : empty && (
              <EmptyState size="md" icon="pass" title="All clear" hint={nextLater ? `Next: ${when(nextLater.starts_at!)} ${nextLater.title}` : 'Type a task below, like “call the bank tomorrow 9”'} />
            )}
            {s.doneToday.length > 0 && (
              <section>
                <Section label="Done" count={s.doneToday.length} open={doneOpen} onToggle={() => setDoneOpen((v) => !v)} action={doneOpen && <Button variant="quiet" size="sm" onClick={() => act.bulk(s.doneToday, 'clear')}>Clear</Button>} />
                {doneOpen && rows(s.doneToday)}
              </section>
            )}
          </>
        )}
        {list === 'tasks' && query == null && !drag && !picked && <button className="as-fab" aria-label="Add task" title="Add task" onClick={() => setAdding(true)} onContextMenu={(e) => { e.preventDefault(); setAdding(Date.now()); }}><Icon name="add" /></button>}
      </div>
      {list === 'tasks' && <SpotBack scroller={scroller} />}

      {drag && <div className="as-ghost" style={{ transform: `translate(${drag.x}px, ${drag.y}px)` }}>{drag.title || '(Untitled)'}</div>}
      <SnackBar />
      {picked ? (
        <div className="as-bulk" role="toolbar" aria-label="Selected tasks">
          <span className="as-bulk-n">{picked.size} selected</span>
          <Button variant="tinted" size="sm" disabled={!chosen.length} onClick={() => bulk('done')}>Done</Button>
          <Button variant="gray" size="sm" disabled={!chosen.length} onClick={() => bulk('tomorrow')}>Move to tomorrow</Button>
          <Button variant="gray" size="sm" disabled={!chosen.length} onClick={() => bulk('snooze')}>Snooze</Button>
          <Button variant="danger" size="sm" disabled={!chosen.length} onClick={() => bulk('delete')}>Delete</Button>
          <Button variant="plain" size="sm" onClick={() => setPicked(null)}>Cancel</Button>
        </div>
      ) : <Composer items={snap.items} next={s.next} filter={filter} />}
      {adding !== false && <AddSheet filter={filter} voice={typeof adding === 'number' ? adding : undefined} onClose={() => setAdding(false)} />}
      {drawerSheet}
    </div>
  );
}
