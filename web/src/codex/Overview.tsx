import { useMemo } from 'react';
import { useAssistant, useCodex } from './data';
import { briefFor, priorWith, type Meeting } from './data/wiki';
import { atTime, latestDigest, latestRunByJob, staleTasks } from './data/engine';
import type { ItemRow } from './data/sync';
import { Icon } from '../ui/Icon';
import { setView, useView } from './view';
import { ActionRow, MeetingRow, confirmAll, peopleOf } from './meetings/Meetings';
import { clock } from './time';
import type { useSplit } from './split';

// The next meeting today: Prep asks Claude, Notes opens the meeting, and the mic toggle tells the transcript reader
// that the room microphone is me.
function NextCard({ m, then, carried, onPrep }: { m: Meeting; then?: Meeting; carried: number; onPrep: () => void }) {
  const { store, snap } = useAssistant();
  const { meetings } = useCodex();
  const prior = useMemo(() => priorWith(m, meetings, snap.items), [m, meetings, snap.items]);
  const brief = useMemo(() => briefFor(m, snap.items, snap.facts), [m, snap.items, snap.facts]);
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
      {prior.length > 0 && (
        <div className="as-ctx-list">
          <div className="muted small">Last time</div>
          {prior.map(({ meeting, decisions, open: openActions }) => (
            <div key={meeting.profile + meeting.id} className="as-ctx">
              <span>{meeting.title}</span>
              <span>{new Date(meeting.starts_at!).toLocaleDateString([], { day: 'numeric', month: 'short' })}</span>
              {decisions[0] && <span className="as-quote">{decisions[0].split('\n')[0]}</span>}
              {openActions.length > 0 && <span className="as-due late">{openActions.length} open</span>}
            </div>
          ))}
        </div>
      )}
      {(brief.tasks.length > 0 || brief.claims.length > 0) && (
        <div className="as-ctx-list">
          {brief.tasks.map(({ person, items }) => (
            <div key={person} className="as-ctx">
              <span>{person}</span>
              <span className="as-due late">{items.length} open</span>
              <span className="as-quote">{items[0].title}</span>
            </div>
          ))}
          {brief.claims.map((f) => <div key={f.profile + f.id} className="as-ctx"><span className="as-quote">{f.text}</span></div>)}
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
  const tasks = () => setView({ list: 'tasks', open: null });
  const stale = useMemo(() => staleTasks(snap.items.filter((r) => filter === 'all' || r.profile === filter), minute * 60000), [snap.items, filter, minute]);
  const stats = [
    { n: dueToday.length, label: 'to do today', cls: '' },
    { n: s.overdue.length, label: 'overdue', cls: 'late' },
    { n: s.review.length, label: 'to confirm', cls: 'review' },
    { n: s.doneToday.length, label: 'done', cls: 'done' },
    { n: stale.length, label: 'stale', cls: '' },
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
      {digest && (
        <section>
          <div className="as-section">{digest.title} · {new Date(digest.updated_at).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}</div>
          <div className="ov-report">{digest.text}</div>
        </section>
      )}
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
