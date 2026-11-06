import { useEffect, useMemo, useState } from 'react';
import { useAssistantData, useSyncGate } from './data';
import { live, type Meeting } from './data/wiki';
import { atTime, latestRunByJob, staleTasks } from './data/engine';
import type { ItemRow } from './data/sync';
import { dayLabel } from './data/dates';
import { plural } from '../ui/util';
import { Section } from '../ui/Section';
import { Capped, Fold } from './Fold';
import { Row } from '../ui/Row';
import { Shutdown } from './Shutdown';
import { ReplyQueue, replyQueue, staleAsks } from './overview/ReplyQueue';
import { NeedsYou, useNeedsYou } from './NeedsYou';
import { DoNow } from './DoNow';
import { useActions } from './useActions';
import { DayPlan, DRAG_TYPE } from './DayPlan';
import { TomorrowCard, useTomorrowCard } from './TomorrowCard';
import { GoalLines } from './Goals';
import { MorningBrief } from './Brief';
import { WeeklyReview } from './WeeklyReview';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { haptic } from '../ui/haptic';
import { openTask, setView, useView } from './view';
import { clock, when } from './time';
import { touch } from '../app/touch';
import type { useSplit } from './split';
import { NextCard } from './overview/NextCard';
import { FollowThrough, useFollowThrough } from './overview/FollowThrough';
import { KeepInTouch, useKeepInTouch } from './overview/KeepInTouch';
import { SinceLastVisit } from './overview/SinceLastVisit';
import { Stale } from './overview/Stale';

export { Review } from './overview/Review';

type Split = ReturnType<typeof useSplit>;

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
  const dueAt = (r: ItemRow) => {
    const t = atTime(r.at);
    return t != null && t >= startOfDay && t < s.endOfDay ? clock(t) : null;
  };
  const shown = (rs: ItemRow[], timed = false) => (
    <div className="ov-follow">
      <Capped items={rs} render={(r) => (
        <div key={r.profile + r.id} className="ov-follow-row" draggable={drag} onDragStart={drag ? (e) => e.dataTransfer.setData(DRAG_TYPE, `${r.profile}:${r.id}`) : undefined}>
          <button className="ov-check" aria-label={`Mark ${r.title} done`} onClick={() => { haptic('success'); act.done(r); }}><Icon name="circle-large-outline" small /></button>
          <button className="ov-follow-text" onClick={() => openTask(r)}>
            <span className="ov-t">{r.title}</span>
            {timed && dueAt(r) && <span className="muted small">{dueAt(r)}</span>}
          </button>
          <button className="ov-check" aria-label={`Snooze ${r.title} to tomorrow`} title="Tomorrow 09:00" onClick={() => snooze(r)}><Icon name="clock" small /></button>
        </div>
      )} />
    </div>
  );
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
  const card = useTomorrowCard(s, tomorrow, now);
  const tomorrowElsewhere = card.shown || !!nextUp?.tomorrow;
  const laterCount = stale.length + follow.rows.length + touchRows.shown.length + (tomorrowElsewhere ? 0 : tomorrow.length);
  const todayShown = todo.length > 0 || !!next || !!nextUp || card.shown;
  const loading = useSyncGate().loading && !snap.items.length;
  const empty = !loading && !reports.length && !needs.rows.length && !s.overdue.length && !dueToday.length && !s.review.length && !next && !upcoming.length && !tomorrow.length && !nextUp && !card.shown;
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
      <div className="ov-block">
        {todayShown && <Section label="Today" />}
        <DoNow needs={needs} today={todo} nextUp={card.shown && nextUp?.tomorrow ? null : nextUp} meeting={close ? null : next} now={now} onPrep={onPrep} />
        <Shutdown open={[...s.overdue, ...dueToday]} done={s.doneToday.length} now={now} profile={filter} />
        {card.shown && <TomorrowCard s={s} tasks={tomorrow} now={now} hide={card.hide} />}
        <DayPlan meetings={s.busyToday} open={dueToday} late={s.overdue} now={now} />
        <GoalLines now={now} />
      </div>
      <div className="ov-block">
        <Section label="Reports" />
        <MorningBrief now={now} />
        <WeeklyReview now={now} />
        {morning && <SinceLastVisit />}
        {reports.length > 0 && (
          <div className="as-group">
            {reports.map(({ j, r }) => <Row key={j.profile + j.id} title={j.name} meta={`${clock(r.started_at!)} · ${firstLine(r.output)}`} onClick={() => setView({ list: 'jobs', open: `${j.profile}:${j.id}` })} />)}
          </div>
        )}
      </div>
      <div className="ov-group">
      <Fold id="later" title="Later" count={laterCount}>
        <Stale rows={stale} now={now} snooze={snooze} />
        <FollowThrough f={follow} />
        <KeepInTouch k={touchRows} />
        {!tomorrowElsewhere && tomorrow.length > 0 && (
          <section>
            <div className="as-section later">Tomorrow</div>
            {tomorrow.length > 0 && shown(tomorrow)}
          </section>
        )}
      </Fold>
      </div>
      {empty && (
        <div className="ov-empty muted small">
          <div>{s.doneToday.length ? `All clear. ${plural(s.doneToday.length, 'task')} done today.` : 'Nothing today'}</div>
          {s.nextLater && <div>Next: {when(s.nextLater.starts_at!)} {s.nextLater.title}</div>}
        </div>
      )}
    </>
  );
}
