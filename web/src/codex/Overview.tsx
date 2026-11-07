import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAssistantData, useSyncGate } from './data';
import { live, type Meeting } from './data/wiki';
import { atTime, latestRunByJob, staleTasks } from './data/engine';
import type { ItemRow } from './data/sync';
import { dayLabel } from './data/dates';
import { Section } from '../ui/Section';
import { Fold } from './Fold';
import { Row } from '../ui/Row';
import { IconButton } from '../ui/Button';
import { Menu, MenuItem } from '../ui/Menu';
import { Shutdown, wrapUpDue } from './Shutdown';
import { standupFor } from './data/review';
import { ReplyQueue, replyQueue, staleAsks } from './overview/ReplyQueue';
import { NeedsYou, useNeedsYou } from './NeedsYou';
import { DoNow } from './DoNow';
import { useActions } from './useActions';
import { DayPlan, DRAG_TYPE, usePlanHint } from './DayPlan';
import { TomorrowCard, TomorrowGroup, useTomorrowCard } from './TomorrowCard';
import { GoalLines } from './Goals';
import { BriefReportCard, useBriefs } from './Brief';
import { WeeklyReviewCard, useWeeklyReviews } from './WeeklyReview';
import { pickReports, type ReportEntry } from './data/reports';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/Panel';
import { AddSheet } from './AddSheet';
import { haptic } from '../ui/haptic';
import { copyText, openTask, setView, useView } from './view';
import { clock, when } from './time';
import { touch } from '../app/touch';
import type { useSplit } from './split';
import { NextCard } from './overview/NextCard';
import { FollowThrough, useFollowThrough } from './overview/FollowThrough';
import { KeepInTouch, useKeepInTouch } from './overview/KeepInTouch';
import { useSinceLastVisit } from './overview/SinceLastVisit';
import { Stale } from './overview/Stale';

export { Review } from './overview/Review';

type Split = ReturnType<typeof useSplit>;
type ReportItem = ReportEntry & { title: string; meta: string; open: () => void; card?: ReactNode };

const firstLine = (text: string | null | undefined) => (text ?? '').split('\n').find((l) => l.trim())?.trim() ?? '';


// The day at a glance: what needs me, the next meeting, today's meetings and tasks, with later items and job reports in folds.
export function Overview({ s, dueToday, onPrep }: { s: Split; dueToday: ItemRow[]; onPrep: () => void }) {
  const act = useActions();
  const snap = useAssistantData();
  const { filter } = useView();
  const now = Date.now();
  const minute = Math.floor(now / 60000);
  const startOfDay = new Date(now).setHours(0, 0, 0, 0);
  const tomorrow = s.later.filter((r) => atTime(r.at)! >= s.endOfDay && atTime(r.at)! < s.endOfTomorrow);
  const reports = useMemo(() => {
    const latest = latestRunByJob(snap.runs, startOfDay);
    return snap.jobs.flatMap((j) => {
      const r = !j.deleted && (filter === 'all' || j.profile === filter) ? latest.get(j.profile + j.id) : undefined;
      return r ? [{ j, r }] : [];
    });
  }, [snap.jobs, snap.runs, filter, startOfDay]);
  const needs = useNeedsYou(s, now);
  const queue = useMemo(() => replyQueue(s.review, now), [s.review, now]);
  const [onlyStale, setOnlyStale] = useState(false);
  const old = staleAsks(queue, now);
  const filtered = onlyStale && old.length > 0;
  useEffect(() => { if (onlyStale && !old.length) setOnlyStale(false); }, [onlyStale, old.length]);
  const showOld = () => {
    setOnlyStale(true);
    requestAnimationFrame(() => document.getElementById('reply-queue')?.scrollIntoView({ block: 'start' }));
  };
  const stale = useMemo(() => {
    const late = new Set(s.overdue.map((r) => r.profile + r.id));
    const shownElsewhere = (r: ItemRow) => { const t = atTime(r.at); return t != null && t < s.endOfTomorrow; };
    return staleTasks(snap.items.filter((r) => (filter === 'all' || r.profile === filter) && !r.meeting_id && !late.has(r.profile + r.id) && !shownElsewhere(r)), minute * 60000);
  }, [snap.items, s.overdue, s.endOfTomorrow, filter, minute]);
  const follow = useFollowThrough();
  const touchRows = useKeepInTouch();
  const morning = new Date(now).getHours() < 11;
  const briefs = useBriefs(now);
  const weekly = useWeeklyReviews(now);
  const since = useSinceLastVisit();
  const [opened, setOpened] = useState<string | null>(null);
  const [closed, setClosed] = useState<string[]>([]);
  const [allRows, setAllRows] = useState(false);
  const all = filter === 'all';
  const closeCard = (key: string, hide: () => void) => { hide(); setClosed((c) => [...c, key]); };
  const entries: ReportItem[] = [
    ...briefs.reports.map((b): ReportItem => ({
      key: b.key, at: b.at, candidate: true, open: () => setOpened(b.key),
      title: `${b.brief.text}${all ? ` · ${b.brief.profile}` : ''}`, meta: `${clock(b.at)} · ${b.first}`,
      card: <BriefReportCard key={b.key} report={b} showProfile={all} onDismiss={() => closeCard(b.key, () => briefs.dismiss(b.key))} />,
    })),
    ...weekly.reports.map((w): ReportItem => {
      const title = `Weekly review${all ? ` · ${w.profile}` : ''}`;
      return {
        key: w.key, at: w.at, candidate: true, open: () => setOpened(w.key), title, meta: `Fri 14:00 · ${w.summary}`,
        card: <WeeklyReviewCard key={w.key} profile={w.profile} now={now} title={title} onHide={() => closeCard(w.key, () => weekly.hide(w.profile))} />,
      };
    }),
    ...reports.map(({ j, r }): ReportItem => ({
      key: `job:${j.profile}${j.id}`, at: r.started_at!, candidate: false, title: j.name ?? j.id, meta: `${clock(r.started_at!)} · ${firstLine(r.output)}`,
      open: () => setView({ list: 'jobs', open: `${j.profile}:${j.id}` }),
    })),
    ...(morning && since.meta ? [{ key: 'since', at: now, candidate: false, title: 'Since you were last here', meta: since.meta, open: since.open }] : []),
  ];
  const picked = pickReports(entries, opened, closed, allRows);
  const snooze = (r: ItemRow) => { haptic('tap'); act.snoozeLater(r, now); };
  const risky = new Set(needs.rows.flatMap((n) => (n.kind === 'risk' ? [n.row.profile + n.row.id] : [])));
  const todo = dueToday.filter((r) => !risky.has(r.profile + r.id));
  // Meetings show here only when running or starting within two hours; the Meetings page has the rest.
  const soon = (m: Meeting) => m.starts_at! - now < 2 * 3600_000 && (m.ends_at ?? m.starts_at!) > now;
  const next = s.next && soon(s.next) ? s.next : null;
  // A meeting starting within 15 minutes or running gets the full card; one later in the two hours is a line in Do now.
  const close = next && next.starts_at! - now < 15 * 60_000 ? next : null;
  const upcoming = s.meetingsToday.filter((m) => m !== s.next && soon(m));
  const drag = !touch();
  const tomorrowRows = tomorrow.map((r) => (
    <Row key={r.profile + r.id} plain className="ov-tm" draggable={drag} onDragStart={drag ? (e) => e.dataTransfer.setData(DRAG_TYPE, `${r.profile}:${r.id}`) : undefined}
      leading={<IconButton icon="check" size="sm" label={`Mark ${r.title} done`} onClick={() => { haptic('success'); act.done(r); }} />}
      title={<button type="button" className="ov-hit" onClick={() => openTask(r)}>{r.title}</button>}
      trailing={<IconButton icon="clock" size="sm" label={`Snooze ${r.title} to tomorrow`} onClick={() => snooze(r)} />} />
  ));
  // A quiet day shows the next day with meetings or tasks, so the page always says what comes next.
  const quiet = !next && !upcoming.length && !todo.length;
  const nextUp = useMemo(() => {
    if (!quiet) return null;
    const end = s.endOfDay + 7 * 86400_000;
    const ts = s.later.filter((r) => atTime(r.at)! >= s.endOfDay && atTime(r.at)! < end);
    if (!ts.length) return null;
    const day = new Date(Math.min(...ts.map((r) => atTime(r.at)!))).setHours(0, 0, 0, 0), after = new Date(day).setHours(24);
    return {
      label: day === s.endOfDay ? 'Tomorrow' : dayLabel(day, true),
      tomorrow: day === s.endOfDay,
      tasks: ts.filter((r) => atTime(r.at)! >= day && atTime(r.at)! < after),
      meetings: live(snap.meetings).filter((m) => (filter === 'all' || m.profile === filter) && m.starts_at! >= day && m.starts_at! < after),
    };
  }, [quiet, s.later, s.endOfDay, snap.meetings, filter]);
  const planHint = usePlanHint(s.busyToday, dueToday, s.overdue, now);
  const [planRequest, setPlanRequest] = useState(0);
  const [wrapShown, setWrapShown] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const choose = (fn: () => void) => () => { setMenuOpen(false); fn(); };
  const showWrap = () => {
    setWrapShown(true);
    requestAnimationFrame(() => wrap.current?.scrollIntoView({ block: 'start' }));
  };
  const todayMenu = (
    <span className="ov-more">
      <IconButton ref={menuButton} size="sm" icon="kebab-horizontal" label="More" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)} />
      {menuOpen && (
        <Menu trigger={menuButton} onClose={() => setMenuOpen(false)}>
          <MenuItem icon="sparkle" disabled={!!planHint} onClick={choose(() => setPlanRequest(planRequest + 1))}>Plan my day</MenuItem>
          {planHint && <div className="ov-menu-hint">{planHint}</div>}
          <MenuItem icon="copy" onClick={choose(() => copyText(standupFor(snap, s.overdue, dueToday, filter, Date.now()), 'Standup copied'))}>Copy standup</MenuItem>
          {wrapUpDue([...s.overdue, ...dueToday], now) && <MenuItem icon="check-all" onClick={choose(showWrap)}>Wrap up</MenuItem>}
        </Menu>
      )}
    </span>
  );
  const card = useTomorrowCard(s, tomorrow, now);
  const tomorrowElsewhere = card.shown || !!nextUp?.tomorrow;
  const laterCount = stale.length + follow.rows.length + touchRows.shown.length + (tomorrowElsewhere ? 0 : tomorrow.length);
  const todayShown = todo.length > 0 || !!next || card.shown;
  const loading = useSyncGate().loading && !snap.items.length;
  const empty = !loading && !close && !needs.rows.length && !queue.length && !todayShown && !s.overdue.length && !dueToday.length;
  const [adding, setAdding] = useState(false);
  const nextHint = () => {
    const task = s.later.filter((r) => atTime(r.at) != null).sort((a, b) => atTime(a.at)! - atTime(b.at)!)[0];
    const meeting = s.nextLater;
    if (task && (!meeting || atTime(task.at)! < meeting.starts_at!)) return `Next: ${when(atTime(task.at)!)} ${task.title}`;
    return meeting ? `Next: ${when(meeting.starts_at!)} ${meeting.title}` : 'Nothing planned. Add a task to start the day.';
  };
  if (loading) return <Skeleton />;
  return (
    <>
      {close && (
        <section>
          <Section label="Now" />
          <NextCard m={close} then={s.then && soon(s.then) ? s.then : undefined} carried={s.carried} onPrep={onPrep} />
        </section>
      )}
      <NeedsYou n={needs} now={now} onShowOld={showOld} />
      <ReplyQueue rows={filtered ? old : queue} filtered={filtered} onClear={() => setOnlyStale(false)} />
      {empty && (
        <EmptyState size="md" icon="pass" title="Nothing today" hint={nextHint()} action={<Button variant="primary" size="sm" onClick={() => setAdding(true)}>New task</Button>} />
      )}
      <div className="ov-block ov-block-today">
        {(todayShown || (!empty && !!nextUp)) && <Section label="Today" action={todayMenu} />}
        <DoNow needs={needs} today={todo} nextUp={empty || (card.shown && nextUp?.tomorrow) ? null : nextUp} meeting={close ? null : next} now={now} onPrep={onPrep} />
        {wrapShown && <div ref={wrap}><Shutdown open={[...s.overdue, ...dueToday]} done={s.doneToday.length} now={now} profile={filter} /></div>}
        {card.shown && <TomorrowCard s={s} tasks={tomorrow} now={now} hide={card.hide} />}
        <DayPlan meetings={s.busyToday} open={dueToday} late={s.overdue} now={now} planRequest={planRequest} />
        <GoalLines now={now} />
      </div>
      {entries.length > 0 && (
        <div className="ov-block">
          <Section label="Reports" />
          {picked.card?.card}
          {picked.rows.length > 0 && (
            <div className="as-group">
              {picked.rows.map((e) => <Row key={e.key} title={e.title} meta={e.meta} onClick={e.open} />)}
            </div>
          )}
          {picked.total > picked.rows.length && <Button variant="quiet" size="sm" className="ov-more" onClick={() => setAllRows(true)}>Show all {picked.total}</Button>}
        </div>
      )}
      <div className="ov-group">
      <Fold id="later" title="Later" count={laterCount}>
        <Stale rows={stale} now={now} snooze={snooze} />
        <FollowThrough f={follow} />
        <KeepInTouch k={touchRows} />
        {!tomorrowElsewhere && <TomorrowGroup label="Tomorrow" rows={tomorrowRows} />}
      </Fold>
      </div>
      {adding && <AddSheet filter={filter} onClose={() => setAdding(false)} />}
    </>
  );
}
