import { useMemo } from 'react';
import { useAssistantData, useSyncGate } from './data';
import { live, type Meeting } from './data/wiki';
import { meetingTimeLeft } from './data/load';
import { atTime, latestDigest, latestRunByJob, staleTasks } from './data/engine';
import type { ItemRow } from './data/sync';
import { plural } from '../ui/util';
import { dayLabel } from './data/dates';
import { Shutdown } from './Shutdown';
import { ClaimsToReview } from './overview/ClaimsToReview';
import { ReplyQueue, replyQueue } from './overview/ReplyQueue';
import { useNeedsYou } from './NeedsYou';
import { DoNow } from './DoNow';
import { useActions } from './useActions';
import { DayPlan, DRAG_TYPE } from './DayPlan';
import { GoalLines } from './Goals';
import { standupText } from './data/review';
import { MorningBrief } from './Brief';
import { Capped, Fold } from './Fold';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { haptic } from '../ui/haptic';
import { copyText, openTask, setView, useView } from './view';
import { MeetingRow } from './meetings/MeetingList';
import { clock, when } from './time';
import { touch } from '../app/touch';
import type { useSplit } from './split';
import { NextCard } from './overview/NextCard';
import { FollowThrough, useFollowThrough } from './overview/FollowThrough';
import { KeepInTouch, useKeepInTouch } from './overview/KeepInTouch';
import { JustEnded } from './overview/JustEnded';
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
  const digest = useMemo(() => latestDigest(snap.items, filter), [snap.items, filter]);
  const needs = useNeedsYou(s, now);
  const queue = useMemo(() => replyQueue(s.review), [s.review]);
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
  const fit = (x: { profile: string; deleted?: unknown }) => !x.deleted && (filter === 'all' || x.profile === filter);
  const slack = snap.chats.some(fit) || snap.briefs.some((b) => fit(b) && b.kind === 'slack');
  const standup = () => copyText(standupText(snap.items.filter((r) => filter === 'all' || r.profile === filter), live(snap.meetings).filter((m) => filter === 'all' || m.profile === filter), [...s.overdue, ...dueToday], Date.now()), 'Standup copied');
  const contextCount = reports.length + (digest ? 1 : 0) + (slack ? 1 : 0) + (morning ? 0 : 1);
  const left = meetingTimeLeft(s.meetingsToday, now, s.endOfDay);
  const leftText = left >= 60 ? `${Math.floor(left / 60)}h${left % 60 ? String(left % 60).padStart(2, '0') : ''}` : `${left} min`;
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
  const laterCount = stale.length + follow.rows.length + touchRows.shown.length + (nextUp?.tomorrow ? 0 : tomorrow.length);
  const loading = useSyncGate().loading && !snap.items.length;
  const empty = !loading && !needs.rows.length && !s.overdue.length && !dueToday.length && !s.review.length && !next && !upcoming.length && !tomorrow.length && !nextUp;
  if (loading) return <Skeleton />;
  return (
    <>
      <GoalLines now={now} />
      <MorningBrief now={now} />
      <ClaimsToReview />
      <ReplyQueue rows={queue} />
      <JustEnded meetings={s.meetingsToday} now={now} />
      {close && (
        <section>
          <div className="as-section next">Now</div>
          <NextCard m={close} then={s.then && soon(s.then) ? s.then : undefined} carried={s.carried} onPrep={onPrep} />
        </section>
      )}
      <DoNow needs={needs} today={todo} nextUp={nextUp} meeting={close ? null : next} now={now} onPrep={onPrep} />
      <Shutdown open={[...s.overdue, ...dueToday]} done={s.doneToday.length} now={now} profile={filter} />
      <DayPlan meetings={s.busyToday} open={dueToday} late={s.overdue} now={now} />
      {morning && (
        <div className="as-next-actions">
          <button className="btn btn-sm btn-gray" onClick={standup}><Icon name="copy" small /> Copy standup</button>
        </div>
      )}
      {morning && <SinceLastVisit />}
      {upcoming.length > 0 && (
        <section>
          <div className="as-section">Meetings today · {upcoming.length}{left > 0 && <span title="Meeting time left today, including the next one"> · {leftText} left</span>}</div>
          <div className="mt-rows ov-card">{upcoming.slice(0, 3).map((m) => <MeetingRow key={m.profile + m.id} m={m} now={now} />)}</div>
          {upcoming.length > 3 && <button className="as-chip quiet ov-more" onClick={() => setView({ list: 'meetings', open: null })}>+{upcoming.length - 3} more</button>}
        </section>
      )}
      <div className="ov-group">
      <Fold id="later" title="Later" count={laterCount}>
        <Stale rows={stale} now={now} snooze={snooze} />
        <FollowThrough f={follow} />
        <KeepInTouch k={touchRows} />
        {!nextUp?.tomorrow && tomorrow.length > 0 && (
          <section>
            <div className="as-section later">Tomorrow</div>
            {tomorrow.length > 0 && shown(tomorrow)}
          </section>
        )}
      </Fold>
      <Fold id="context" title="Context" count={contextCount}>
        {!morning && (
          <div className="ov-follow">
            <div className="ov-follow-row">
              <button className="ov-follow-text" onClick={standup}>
                <span className="ov-t"><Icon name="copy" small /> Copy standup</span>
              </button>
            </div>
          </div>
        )}
        {slack && (
          <div className="ov-follow">
            <div className="ov-follow-row">
              <button className="ov-follow-text" onClick={() => setView({ list: 'summary', open: null })}>
                <span className="ov-t">Slack summary <span className="muted small">Each chat and a summary on demand</span></span>
              </button>
            </div>
          </div>
        )}
        {reports.length > 0 && (
          <div className="ov-follow">
            {reports.map(({ j, r }) => (
              <div key={j.profile + j.id} className="ov-follow-row">
                <button className="ov-follow-text" onClick={() => setView({ list: 'jobs', open: `${j.profile}:${j.id}` })}>
                  <span className="ov-t">{j.name} <span className="muted small">{clock(r.started_at!)} · {firstLine(r.output)}</span></span>
                </button>
              </div>
            ))}
          </div>
        )}
        {digest && (
          <section>
            <div className="as-section">{digest.title} · {dayLabel(digest.updated_at, true)}</div>
            <div className="ov-report">{digest.text}</div>
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
