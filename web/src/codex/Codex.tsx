import { Suspense, useCallback, useRef, useState } from 'react';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import { codexMeetings, useAssistant, useSyncGate } from './data';
import { ask, askText } from './data/ask/ask';
import { reviewedSince } from './data/tasks/engine';
import { greeting } from './tasks/days';
import { dropRow as dropRowTo, moveOverdue } from './tasks/rowMoves';
import { TasksHead } from './TasksHead';
import { SnackBar } from './tasks/SnackBar';
import { useHubLifecycle } from './useHubLifecycle';
import { rowKey, type ItemRow } from './data/sync';
import type { BulkKind } from './useActions';
import { Icon } from '../ui/Icon';
import { EmptyState } from '../ui/Panel';
import { Button } from '../ui/Button';
import { Section } from '../ui/Section';
import { haptic } from '../ui/haptic';
import { searchRun, setView, showSnack, useSpotBack, useView } from './view';
import { when } from './tasks/time';
import { Composer, prepText } from './AskBar';
import { AddSheet } from './tasks/AddSheet';
import { TagPage } from './tasks/TagPage';
import { useActions } from './tasks/Task';
import { DayGroup, TaskList, type Day } from './tasks/TaskGroup';
import { Overview, Review } from './Overview';
import { useSplit } from './tasks/split';
import { dayGroups } from './tasks/dayGroups';
import { BulkBar } from './tasks/BulkBar';
import { SearchBar, SearchResults, useTaskSearch } from './tasks/TaskSearch';
import { pickable, useTaskSelection } from './tasks/useTaskSelection';
import { ListsDrawer, LockedCodex } from './CodexChrome';
import { LISTS } from './nav';
import { useDrag, type Drop } from './gestures/drag';
import { usePullRefresh, useScrolledHeader } from './gestures/usePullRefresh';
import { Skeleton } from '../ui/Skeleton';
import { prefetch } from '../app/lazy';
import '../styles/features/assistant.css';
import '../styles/features/overview.css';

const TaskEditor = prefetch(() => import('./tasks/editor/TaskEditor').then((m) => m.TaskEditor));
const Wiki = prefetch(() => import('./wiki/Wiki').then((m) => m.Wiki));
const Jobs = prefetch(() => import('./jobs/Jobs').then((m) => m.Jobs));
const Summary = prefetch(() => import('./summary/Summary').then((m) => m.Summary));
const GoalsPage = prefetch(() => import('./tasks/GoalsPage').then((m) => m.GoalsPage));
const Search = prefetch(() => import('./Search').then((m) => m.Search));
const Meetings = prefetch(() => import('./meetings/Meetings').then((m) => m.Meetings));

const DAY = 86400_000;

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
  const [query, setQuery] = useTaskSearch(list, root);
  const { picked, setPicked, toggle } = useTaskSelection(list, snap.items, [list, filter, query != null], () => setAdding(true));
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

  if (!ready) return <LockedCodex root={root} snap={snap} store={store} />;

  const drawerSheet = drawer && <ListsDrawer close={() => setDrawer(false)} />;

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
  const { days, dueToday, startOfDay } = dayGroups(s, now, !!drag);
  function dropRow(row: ItemRow, d: Drop) {
    dropRowTo(act, days, startOfDay, row, d);
  }
  const chosen = picked ? snap.items.filter((r) => pickable(r) && picked.has(r.profile + r.id)) : [];
  const bulk = (kind: BulkKind) => { act.bulk(chosen, kind); setPicked(null); };
  const openRow = (r: ItemRow) => picked ? pickable(r) && toggle(r.profile + r.id) : setView({ open: rowKey(r) });
  const rows = (rs: ItemRow[], key?: string, droppable = true) => <TaskList rows={rs} sectionKey={key} droppable={droppable} drag={drag} picked={picked} onOpen={openRow} start={start} />;
  const section = (d: Day) => <DayGroup key={d.key} d={d} drag={drag} picked={picked} onOpen={openRow} start={start} />;
  const fresh = s.review.filter((r) => now - reviewedSince(r) < DAY);
  const older = s.review.filter((r) => now - reviewedSince(r) >= DAY);
  const empty = !s.overdue.length && days.every((d) => !d.rows.length) && !s.review.length;
  const nextLater = s.nextLater;
  return (
    <div className={`assistant${list === 'tasks' ? ' tasks' : ''}`} ref={root}>
      <TasksHead list={list} heading={heading} filter={filter} searching={query != null} selecting={!!picked} onMenu={() => setDrawer(true)} onAdd={() => setAdding(true)} onSelect={() => setPicked(new Set())} onSearch={() => setQuery('')} />
      {gate.error && <button className="as-error" onClick={() => store.syncNow()}><Icon name="warning" small /> Sync failed: {gate.error}. Your changes are kept on this device.</button>}
      {calError && <button className="as-error" onClick={() => void retryCalendar()}><Icon name="warning" small /> Calendar not updated: {calError}. Tap to retry.</button>}

      <div className="as-ptr" ref={ptr} aria-hidden><Icon name="refresh" /></div>
      <div className={`as-scroll${drag ? ' dragging' : ''}`} ref={scroller}>
        {list === 'today' && <Overview s={s} dueToday={dueToday} onPrep={() => ask(askText(prepText(s.next!), s.next!.profile, snap.items, undefined, codexMeetings(snap.meetings)), s.next!.profile)} />}
        {list === 'tasks' && query != null && <SearchBar query={query} setQuery={setQuery} />}
        {list === 'tasks' && query?.trim() && <SearchResults query={query} candidates={[...s.overdue, ...days.flatMap((d) => d.rows), ...s.review, ...s.doneToday]} rows={rows} />}
        {list === 'tasks' && !query?.trim() && (
          <>
            {s.overdue.length > 0 && (
              <section>
                <Section label="Overdue" count={s.overdue.length} action={!picked && <Button variant="quiet" size="sm" onClick={() => moveOverdue(act, s.overdue, startOfDay)}>Move all to today</Button>} />
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
      {picked ? <BulkBar count={picked.size} enabled={chosen.length > 0} bulk={bulk} cancel={() => setPicked(null)} /> : <Composer items={snap.items} next={s.next} filter={filter} />}
      {adding !== false && <AddSheet filter={filter} voice={typeof adding === 'number' ? adding : undefined} onClose={() => setAdding(false)} />}
      {drawerSheet}
    </div>
  );
}
