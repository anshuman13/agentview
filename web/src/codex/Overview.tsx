import { useEffect, useMemo, useState } from 'react';
import { useAssistant, useCodex } from './data';
import { live, type Meeting } from './data/wiki';
import { atTime, split } from './data/engine';
import type { ItemRow } from './data/sync';
import { Icon } from '../ui/Icon';
import { setView, useView } from './view';
import { ActionRow, MeetingRow, confirmAll, peopleOf } from './meetings/Meetings';
import { clock } from './time';

// Re-renders every minute and when the app comes back to the front, so due tasks move into Today.
export function useMinute() {
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

export function useSplit() {
  const { snap } = useAssistant();
  const { meetings } = useCodex();
  const { filter } = useView();
  const minute = useMinute();
  return useMemo(() => {
    const now = Date.now();
    const all = live(meetings).filter((m) => m.starts_at != null && (filter === 'all' || m.profile === filter));
    const ahead = all.filter((m) => (m.ends_at ?? m.starts_at!) > now).sort((a, b) => a.starts_at! - b.starts_at!);
    const endOfDay = new Date(now).setHours(24, 0, 0, 0);
    const today = ahead.filter((m) => m.starts_at! < endOfDay);
    const next = today[0];
    const startOfDay = new Date(now).setHours(0, 0, 0, 0);
    const endOfTomorrow = new Date(now).setHours(48, 0, 0, 0);
    const byStart = (a: Meeting, b: Meeting) => a.starts_at! - b.starts_at!;
    // Open actions from earlier meetings with the same title.
    const carried = next ? snap.items.filter((r) => !r.deleted && r.status === 'open' && r.meeting_id && r.profile === next.profile && r.meeting_id !== next.id
      && all.some((m) => m.id === r.meeting_id && m.profile === next.profile && m.title === next.title && m.starts_at! < next.starts_at!)).length : 0;
    return {
      ...split(snap.items, filter, now), next, then: today[1], carried, endOfDay, endOfTomorrow,
      meetingsToday: all.filter((m) => m.starts_at! >= startOfDay && m.starts_at! < endOfDay).sort(byStart),
      meetingsTomorrow: all.filter((m) => m.starts_at! >= endOfDay && m.starts_at! < endOfTomorrow).sort(byStart),
      nextLater: today.find((m) => m !== next && m.starts_at! > now) ?? ahead.find((m) => m.starts_at! >= endOfDay),
    };
  }, [snap.items, meetings, filter, minute]);
}

// The next meeting today: Prep asks Claude, Notes opens the meeting, and the mic toggle tells the transcript reader
// that the room microphone is me.
function NextCard({ m, then, carried, onPrep }: { m: Meeting; then?: Meeting; carried: number; onPrep: () => void }) {
  const { store } = useAssistant();
  const now = Date.now();
  const mins = Math.round((m.starts_at! - now) / 60000);
  const open = () => setView({ list: 'meetings', open: `${m.profile}:${m.id}` });
  const people = peopleOf(m);
  return (
    <div className="as-next" onClick={open} role="button" tabIndex={0} onKeyDown={(e) => e.target === e.currentTarget && e.key === 'Enter' && open()}>
      <div className="as-next-head"><Icon name="calendar" small /> {clock(m.starts_at!)} <span className="muted">· {mins <= 0 ? 'now' : mins < 60 ? `in ${mins} min` : `in ${Math.round(mins / 60)} h`}</span></div>
      <div className="as-next-title">{m.title}</div>
      {(people.length > 0 || carried > 0) && (
        <div className="as-ctx">
          {people.length > 0 && <span>{people.slice(0, 3).join(', ')}{people.length > 3 ? ` +${people.length - 3}` : ''}</span>}
          {carried > 0 && <span className="as-due late">{carried} open from last time</span>}
        </div>
      )}
      <div className="as-next-actions">
        <button className="btn sm" onClick={(e) => { e.stopPropagation(); onPrep(); }}><Icon name="sparkle" small /> Prep</button>
        <button className="btn sm" onClick={(e) => { e.stopPropagation(); open(); }}><Icon name="edit" small /> Notes</button>
        {m.id.startsWith('cal:') && (
          <button className={`btn sm${m.room_me === 1 ? ' on' : ''}`} title="I am on the room microphone in this meeting" aria-pressed={m.room_me === 1}
            onClick={(e) => { e.stopPropagation(); void store.editRow('meetings', m, { room_me: m.room_me === 1 ? null : 1 }); }}>
            <Icon name="mic" small /> Room mic is me
          </button>
        )}
      </div>
      {then && <div className="as-next-then">then {clock(then.starts_at!)} {then.title}</div>}
    </div>
  );
}

// Suggested actions grouped by meeting, each group with Confirm all.
export function Review({ rows }: { rows: ItemRow[] }) {
  const { store } = useAssistant();
  const groups = rows.reduce<ItemRow[][]>((acc, r) => {
    const g = acc.find((x) => x[0].profile === r.profile && x[0].meeting_id === r.meeting_id);
    if (g) g.push(r);
    else acc.push([r]);
    return acc;
  }, []);
  return groups.map((g) => (
    <section key={g[0].profile + g[0].meeting_id}>
      <button className="as-section review as-toggle" onClick={() => setView({ list: 'meetings', open: `${g[0].profile}:${g[0].meeting_id}` })}>Is this yours? · {g[0].people || 'Meeting'}</button>
      <div className="as-group">
        {g.map((r) => <ActionRow key={r.profile + r.id} row={r} />)}
        {g.length > 1 && <button className="as-confirm-all" onClick={() => confirmAll(store, g)}><Icon name="check-all" small /> Confirm all {g.length}</button>}
      </div>
    </section>
  ));
}

type Split = ReturnType<typeof useSplit>;

// The day at a glance: counts that open Tasks, the next meeting, today's and tomorrow's meetings, and what jobs reported today.
export function Overview({ s, dueToday, onPrep }: { s: Split; dueToday: ItemRow[]; onPrep: () => void }) {
  const { snap } = useAssistant();
  const { filter } = useView();
  const now = Date.now();
  const tomorrow = s.later.filter((r) => atTime(r.at)! >= s.endOfDay && atTime(r.at)! < s.endOfTomorrow);
  const startOfDay = new Date(now).setHours(0, 0, 0, 0);
  const jobs = snap.jobs.filter((j) => !j.deleted && (filter === 'all' || j.profile === filter));
  const reports = jobs.flatMap((j) => {
    const r = snap.runs.filter((x) => !x.deleted && x.profile === j.profile && x.job_id === j.id && x.status === 'ok' && (x.started_at ?? 0) >= startOfDay).sort((a, b) => b.started_at! - a.started_at!)[0];
    return r?.output ? [{ j, r }] : [];
  });
  const tasks = () => setView({ list: 'tasks', open: null });
  const stats = [
    { n: dueToday.length, label: 'to do today', cls: '' },
    { n: s.overdue.length, label: 'overdue', cls: 'late' },
    { n: s.review.length, label: 'to confirm', cls: 'review' },
    { n: s.doneToday.length, label: 'done', cls: 'done' },
  ].filter((x, i) => i === 0 || x.n > 0);
  const shown = (rs: ItemRow[]) => (
    <button className="ov-list" onClick={tasks}>
      {rs.slice(0, 5).map((r) => <span key={r.profile + r.id}><Icon name="circle-large-outline" small /><span className="ov-t">{r.title}</span></span>)}
      {rs.length > 5 && <span className="muted">+{rs.length - 5} more</span>}
    </button>
  );
  return (
    <>
      <div className="ov-summary">
        {stats.map((x) => <button key={x.label} className={`ov-stat ${x.cls}`} onClick={tasks}><b>{x.n}</b><span>{x.label}</span></button>)}
      </div>
      {s.next && (
        <section>
          <div className="as-section next">Next</div>
          <NextCard m={s.next} then={s.then} carried={s.carried} onPrep={onPrep} />
        </section>
      )}
      {s.meetingsToday.length > 0 && (
        <section>
          <div className="as-section">Meetings today · {s.meetingsToday.length}</div>
          <div className="mt-rows ov-card">{s.meetingsToday.map((m) => <MeetingRow key={m.profile + m.id} m={m} now={now} />)}</div>
        </section>
      )}
      {dueToday.length > 0 && (
        <section>
          <div className="as-section">To do today · {dueToday.length}</div>
          {shown(dueToday)}
        </section>
      )}
      {(s.meetingsTomorrow.length > 0 || tomorrow.length > 0) && (
        <section>
          <div className="as-section later">Tomorrow</div>
          {s.meetingsTomorrow.length > 0 && <div className="mt-rows ov-card">{s.meetingsTomorrow.map((m) => <MeetingRow key={m.profile + m.id} m={m} now={now} />)}</div>}
          {tomorrow.length > 0 && shown(tomorrow)}
        </section>
      )}
      {reports.map(({ j, r }) => (
        <section key={j.profile + j.id}>
          <button className="as-section as-toggle" onClick={() => setView({ list: 'jobs', open: `${j.profile}:${j.id}` })}>{j.name} · {clock(r.started_at!)}</button>
          <div className="ov-report">{r.output}</div>
        </section>
      ))}
    </>
  );
}
