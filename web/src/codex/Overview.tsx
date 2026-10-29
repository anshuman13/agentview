import { useMemo, useState } from 'react';
import { useAssistantStore, useAssistantData, useCodex } from './data';
import { followThrough, type Meeting } from './data/wiki';
import { sinceLastVisit } from './data/load';
import { SlackCard } from './summary/Summary';
import { resolvedQuestions } from './meetings/OpenQuestions';
import { atTime, latestDigest, latestRunByJob, staleTasks } from './data/engine';
import type { ItemRow } from './data/sync';
import { save, stored } from '../ui/util';
import { meetingKey } from './meetings/MeetingList';
import { Prep } from './meetings/Prep';
import { Icon } from '../ui/Icon';
import { setView, useView } from './view';
import { ActionRow, MeetingRow, confirmAll, peopleOf } from './meetings/Meetings';
import { clock } from './time';
import type { useSplit } from './split';

// The next meeting today: Prep asks Claude, Notes opens the meeting, and the mic toggle tells the transcript reader
// that the room microphone is me.
function NextCard({ m, then, carried, onPrep }: { m: Meeting; then?: Meeting; carried: number; onPrep: () => void }) {
  const store = useAssistantStore();
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
      <Prep m={m} />
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
  const store = useAssistantStore();
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

const DISMISSED = 'agentview:followThrough';

// Open actions from meetings over a week old: Task unlinks one from its meeting so it is a plain task, Dismiss hides it here.
function FollowThrough() {
  const store = useAssistantStore();
  const snap = useAssistantData();
  const { meetings } = useCodex();
  const { filter } = useView();
  const [dismissed, setDismissed] = useState<string[]>(() => stored<string[]>(DISMISSED, []));
  const minute = Math.floor(Date.now() / 60000);
  const rows = useMemo(
    () => followThrough(snap.items, meetings.filter((m) => filter === 'all' || m.profile === filter), dismissed, minute * 60000),
    [snap.items, meetings, filter, dismissed, minute],
  );
  if (!rows.length) return null;
  const dismiss = (r: ItemRow) => {
    const live = new Set(snap.items.filter((x) => !x.deleted && x.meeting_id).map((x) => x.profile + x.id));
    const next = [...new Set([...dismissed, r.profile + r.id])].filter((k) => live.has(k));
    setDismissed(next);
    save(DISMISSED, next);
  };
  return (
    <section>
      <div className="as-section">Follow-through · {rows.length}</div>
      <div className="ov-follow">
        {rows.slice(0, 5).map(({ r, m }) => (
          <div key={r.profile + r.id} className="ov-follow-row">
            <button className="ov-follow-text" onClick={() => setView({ list: 'meetings', open: meetingKey(m), person: null })}>
              <span className="ov-t">{r.title}</span>
              <span className="muted small">{m.title} · {new Date(m.starts_at!).toLocaleDateString([], { day: 'numeric', month: 'short' })}</span>
            </button>
            <button className="btn sm" aria-label={`Make ${r.title} a plain task`} onClick={() => void store.update(r, { meeting_id: null })}>Task</button>
            <button className="btn sm" aria-label={`Dismiss ${r.title}`} onClick={() => dismiss(r)}>Dismiss</button>
          </div>
        ))}
        {rows.length > 5 && <div className="ov-follow-row muted">+{rows.length - 5} more</div>}
      </div>
    </section>
  );
}

const LAST_VISIT = 'codex.lastVisit';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Meetings, decisions, new claims and open questions since the last dismissal; the first visit only records the time.
function SinceLastVisit() {
  const snap = useAssistantData();
  const { filter } = useView();
  const [since, setSince] = useState<number | null>(() => {
    const t = stored<number | null>(LAST_VISIT, null);
    if (t == null) save(LAST_VISIT, Date.now());
    return t;
  });
  const minute = Math.floor(Date.now() / 60000);
  const counts = useMemo(() => {
    const pick = <T extends { profile: string }>(rows: T[]) => rows.filter((r) => filter === 'all' || r.profile === filter);
    return since == null ? null : sinceLastVisit({ meetings: pick(snap.meetings), facts: pick(snap.facts) }, since, minute * 60000, resolvedQuestions());
  }, [snap.meetings, snap.facts, filter, since, minute]);
  if (!counts) return null;
  const parts = [
    counts.meetings && plural(counts.meetings, 'meeting'),
    counts.decisions && plural(counts.decisions, 'decision'),
    counts.claims && plural(counts.claims, 'new claim'),
    counts.questions && plural(counts.questions, 'open question'),
  ].filter(Boolean);
  if (!parts.length) return null;
  const dismiss = () => {
    const now = Date.now();
    save(LAST_VISIT, now);
    setSince(now);
  };
  return (
    <section>
      <div className="ov-follow">
        <div className="ov-follow-row">
          <span className="ov-follow-text">Since you were last here: {parts.join(', ')}</span>
          <button className="btn sm" onClick={dismiss}>Dismiss</button>
        </div>
      </div>
    </section>
  );
}

type Split = ReturnType<typeof useSplit>;

// The day at a glance: counts that open Tasks, the next meeting, today's and tomorrow's meetings, and what jobs reported today.
export function Overview({ s, dueToday, onPrep }: { s: Split; dueToday: ItemRow[]; onPrep: () => void }) {
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
      <SinceLastVisit />
      <SlackCard />
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
      <FollowThrough />
      {reports.map(({ j, r }) => (
        <section key={j.profile + j.id}>
          <button className="as-section as-toggle" onClick={() => setView({ list: 'jobs', open: `${j.profile}:${j.id}` })}>{j.name} · {clock(r.started_at!)}</button>
          <div className="ov-report">{r.output}</div>
        </section>
      ))}
    </>
  );
}
