import { useMemo, useRef, useState } from 'react';
import { useAssistantStore, useAssistantData, useCodex, useSyncStatus } from './data';
import { live, type Chat, type Meeting } from './data/wiki';
import { actionsOf, displayName, followThrough } from './data/meetings';
import { followUpText } from './data/meetingMarkdown';
import { meetingTimeLeft, sinceLastVisit } from './data/load';
import { SlackCard } from './summary/Summary';
import { resolvedQuestions } from './meetings/OpenQuestions';
import { atTime, errorText, latestDigest, latestRunByJob, nextNine, staleTasks } from './data/engine';
import { isSaid, type ItemRow } from './data/sync';
import { ago, safeHref, save, stored, plural } from '../ui/util';
import { dayLabel } from './data/dates';
import { Prep } from './meetings/Prep';
import { Shutdown } from './Shutdown';
import { SinceMeeting } from './SinceMeeting';
import { channelOf, sourceOf } from './taskSource';
import { useActions } from './useActions';
import { DayPlan, DRAG_TYPE } from './DayPlan';
import { GoalLines } from './Goals';
import { atRisk, minutesText, type Span } from './data/plan';
import { keepInTouch, standupText, touchText, type Lapsed } from './data/review';
import { blockId, isBlock } from '../../../shared/util';
import { MorningBrief } from './Brief';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { haptic } from '../ui/haptic';
import { copyText, focusPast, openMeeting, setView, setViewAt, showSnack, useView } from './view';
import { ActionRow, MeetingRow, confirmAll, peopleOf } from './meetings/Meetings';
import { clock, when } from './time';
import { touch } from '../app/touch';
import type { useSplit } from './split';

// The next meeting today: Prep asks Claude, Notes opens the meeting, and the mic toggle tells the transcript reader
// that the room microphone is me.
function NextCard({ m, then, carried, onPrep }: { m: Meeting; then?: Meeting; carried: number; onPrep: () => void }) {
  const store = useAssistantStore();
  const now = Date.now();
  const mins = Math.round((m.starts_at! - now) / 60000);
  const open = () => setView({ list: 'meetings', open: `${m.profile}:${m.id}` });
  const people = peopleOf(m);
  const [jot, setJot] = useState('');
  const saved = useRef('');
  const addNote = () => {
    const text = jot.trim();
    if (!text || saved.current === jot) return;
    saved.current = jot;
    setJot('');
    const line = `${clock(Date.now())} ${text}`;
    const cur = store.snapshot().meetings.find((x) => x.profile === m.profile && x.id === m.id) ?? m;
    void store.editRow('meetings', cur, { notes: cur.notes ? `${cur.notes.trimEnd()}\n${line}` : line }).then(() => showSnack('Added to the notes'));
  };
  return (
    <div className="as-next" onClick={open} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } }}>
      <div className="as-next-head"><Icon name="calendar" small /> {clock(m.starts_at!)} <span className="muted">· {mins <= 0 ? 'now' : mins < 60 ? `in ${mins} min` : `in ${Math.round(mins / 60)} h`}</span></div>
      <div className="as-next-title">{m.title}</div>
      {(people.length > 0 || carried > 0) && (
        <div className="as-ctx">
          {people.length > 0 && <span>{people.slice(0, 3).join(', ')}{people.length > 3 ? ` +${people.length - 3}` : ''}</span>}
          {carried > 0 && <span className="as-due late">{carried} open from last time</span>}
        </div>
      )}
      <Prep m={m} />
      <input className="as-next-jot" value={jot} placeholder="Jot a note" enterKeyHint="done" aria-label={`Note for ${m.title}`}
        onClick={(e) => e.stopPropagation()} onChange={(e) => { saved.current = ''; setJot(e.target.value); }} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') addNote(); }} onBlur={addNote} />
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

// Suggested actions grouped by meeting, or by source for Slack and Gmail asks, each group with Confirm all.
// The hub gives my own promises from Slack and Gmail a said: id, and they group apart as "You said".
const groupOf = (r: ItemRow) => r.meeting_id ?? `source:${r.source ?? ''}${isSaid(r) ? ':said' : ''}`;

export function Review({ rows }: { rows: ItemRow[] }) {
  const store = useAssistantStore();
  const groups = rows.reduce<ItemRow[][]>((acc, r) => {
    const g = acc.find((x) => x[0].profile === r.profile && groupOf(x[0]) === groupOf(r));
    if (g) g.push(r);
    else acc.push([r]);
    return acc;
  }, []);
  return groups.map((g) => (
    <section key={g[0].profile + groupOf(g[0])}>
      {g[0].meeting_id
        ? <button className="as-section review as-toggle" onClick={() => setView({ list: 'meetings', open: `${g[0].profile}:${g[0].meeting_id}` })}>Is this yours? · {g[0].people || 'Meeting'}</button>
        : <div className="as-section review">{isSaid(g[0]) ? 'You said' : 'Is this yours?'} · {channelOf(g[0]).label}</div>}
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
  const section = useRef<HTMLElement>(null);
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
    focusPast(section.current);
  };
  return (
    <section ref={section}>
      <div className="as-section">Follow-through · {rows.length}</div>
      <div className="ov-follow">
        {rows.slice(0, 5).map(({ r, m }) => (
          <div key={r.profile + r.id} className="ov-follow-row">
            <button className="ov-follow-text" onClick={() => openMeeting(m)}>
              <span className="ov-t">{r.title}</span>
              <span className="muted small">{m.title} · {dayLabel(m.starts_at!)}</span>
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

const TOUCH_DISMISSED = 'codex.keepInTouch';

// People I usually meet or DM who have gone quiet for over 1.5x their usual gap: Copy nudge copies a short line, Dismiss hides them until the next contact.
function KeepInTouch() {
  const snap = useAssistantData();
  const { filter } = useView();
  const [dismissed, setDismissed] = useState<string[]>(() => stored<string[]>(TOUCH_DISMISSED, []));
  const list = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const hour = Math.floor(Date.now() / 3600_000);
  const rows = useMemo(() => {
    const pick = <T extends { profile: string }>(xs: T[]) => xs.filter((x) => filter === 'all' || x.profile === filter);
    // The current time, as a contact from this hour would be past an hour-rounded now and not count.
    return keepInTouch(pick(snap.meetings), pick(snap.chats), pick(snap.items), Date.now());
  }, [snap.meetings, snap.chats, snap.items, filter, hour]);
  const shown = rows.filter((x) => !dismissed.includes(x.key));
  if (!shown.length) return null;
  const dismiss = (x: Lapsed, i: number) => {
    const next = [...dismissed.filter((k) => rows.some((r) => r.key === k)), x.key];
    setDismissed(next);
    save(TOUCH_DISMISSED, next);
    // Focus the person that moved into this row, or the one above when the last went.
    requestAnimationFrame(() => {
      const people = list.current?.querySelectorAll<HTMLElement>('button.ov-follow-text');
      people?.[Math.min(i, people.length - 1)]?.focus();
    });
    focusPast(section.current);
  };
  return (
    <section ref={section}>
      <div className="as-section">Keep in touch · {shown.length}</div>
      <div className="ov-follow" role="list" aria-label="Keep in touch" ref={list}>
        {shown.slice(0, 5).map((x, i) => (
          <div key={x.key} className="ov-follow-row wrap" role="listitem">
            <button className="ov-follow-text" onClick={() => setView({ person: x.name })}>
              <span className="ov-t">{displayName(x.name)}</span>
              <span className="muted small">last {dayLabel(x.last)} · usually every {plural(Math.max(1, Math.round(x.gap / 86400000)), 'day')}</span>
            </button>
            <button className="btn sm" aria-label={`Copy a nudge to ${x.name}`} onClick={() => copyText(touchText(x.name), 'Nudge copied')}><Icon name="copy" small /> Copy nudge</button>
            <button className="btn sm" aria-label={`Dismiss ${x.name}`} onClick={() => dismiss(x, i)}>Dismiss</button>
          </div>
        ))}
        {shown.length > 5 && <div className="ov-follow-row muted" role="listitem">+{shown.length - 5} more</div>}
      </div>
    </section>
  );
}

const WAIT_HANDLED = 'codex.waitingHandled';
const waitKey = (c: Chat) => `${c.profile}:${c.id}:${c.last_at ?? ''}`;

// DMs where the other person wrote last and I have not replied, newest first. Task makes a task with the DM link and
// hides the DM until its next message; Dismiss only hides it.
function WaitingOnYou() {
  const store = useAssistantStore();
  const snap = useAssistantData();
  const { filter } = useView();
  const [handled, setHandled] = useState<string[]>(() => stored<string[]>(WAIT_HANDLED, []));
  const list = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const pending = useRef(new Set<string>());
  const rows = useMemo(
    () => live(snap.chats).filter((c) => c.kind === 'dm' && c.waiting === 1 && (filter === 'all' || c.profile === filter)).sort((a, b) => (b.last_at ?? 0) - (a.last_at ?? 0)),
    [snap.chats, filter],
  );
  const shown = rows.filter((c) => !handled.includes(waitKey(c)));
  if (!shown.length) return null;
  const hide = (c: Chat, i: number) => {
    const next = [...handled.filter((k) => rows.some((r) => waitKey(r) === k)), waitKey(c)];
    setHandled(next);
    save(WAIT_HANDLED, next);
    requestAnimationFrame(() => {
      const people = list.current?.querySelectorAll<HTMLElement>('button.ov-follow-text');
      people?.[Math.min(i, people.length - 1)]?.focus();
    });
    focusPast(section.current);
  };
  const task = (c: Chat, i: number) => {
    const key = waitKey(c);
    if (pending.current.has(key)) return;
    pending.current.add(key);
    haptic('tap');
    const name = c.name ?? 'DM';
    void store.capture(`Reply to ${name}`, 'task', c.profile)
      .then((r) => store.update(r, { text: [c.summary, safeHref(c.url)].filter(Boolean).join('\n\n') || null, source: 'slack', people: `${name} · DM` }))
      .then(() => {
        hide(c, i);
        showSnack('Added to Tasks');
      }, (err) => {
        pending.current.delete(key);
        showSnack(`Could not add: ${errorText(err)}`);
      });
  };
  return (
    <section ref={section}>
      <div className="as-section">Waiting on you · {shown.length}</div>
      <div className="ov-follow ov-wait" role="list" aria-label="Waiting on you" ref={list}>
        {shown.slice(0, 6).map((c, i) => (
          <div key={c.profile + c.id} className="ov-follow-row wrap" role="listitem">
            <button className="ov-follow-text" onClick={() => setView({ person: c.name })}>
              <span className="ov-t">{c.name}</span>
              <span className="muted small">{c.last_at ? `${ago(c.last_at, ' ago')} · ` : ''}{c.summary}</span>
            </button>
            {safeHref(c.url) && <a className="btn sm" href={safeHref(c.url)} target="_blank" rel="noreferrer" aria-label={`Open the DM with ${c.name} in Slack`}>Open in Slack</a>}
            <button className="btn sm" aria-label={`Make a task to reply to ${c.name}`} onClick={() => task(c, i)}>Task</button>
            <button className="btn sm" aria-label={`Dismiss ${c.name}`} onClick={() => hide(c, i)}>Dismiss</button>
          </div>
        ))}
      </div>
    </section>
  );
}

const JUST_ENDED_MS = 2 * 3600_000;

// Meetings that ended in the last two hours, with their actions, a follow-up draft to copy and the notes.
function JustEnded({ meetings, now }: { meetings: Meeting[]; now: number }) {
  const snap = useAssistantData();
  const ended = meetings.filter((m) => m.ends_at != null && m.ends_at <= now && now - m.ends_at < JUST_ENDED_MS);
  if (!ended.length) return null;
  return ended.map((m) => {
    const actions = actionsOf(snap.items, m).filter((r) => r.status === 'open' || r.status === 'suggested');
    const copy = () => copyText(followUpText(m, actions), 'Follow-up copied');
    return (
      <section key={m.profile + m.id}>
        <div className="as-section">Just ended · {m.title}</div>
        {actions.length > 0 && <div className="as-group">{actions.map((r) => <ActionRow key={r.profile + r.id} row={r} />)}</div>}
        <div className="as-next-actions">
          {!actions.length && <span className="muted small ov-follow-text">No actions yet. Open the notes to read the transcript.</span>}
          <button className="btn sm" onClick={copy}><Icon name="mail" small /> Copy follow-up</button>
          <button className="btn sm" onClick={() => openMeeting(m)}><Icon name="edit" small /> Notes</button>
        </div>
      </section>
    );
  });
}

const LAST_VISIT = 'codex.lastVisit';


// Meetings, decisions, new claims and open questions since the last dismissal; the first visit only records the time.
function SinceLastVisit() {
  const snap = useAssistantData();
  const { filter } = useView();
  const [since, setSince] = useState<number | null>(() => {
    const t = stored<number | null>(LAST_VISIT, null);
    if (t == null) save(LAST_VISIT, Date.now());
    return t;
  });
  const section = useRef<HTMLElement>(null);
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
    focusPast(section.current);
  };
  return (
    <section ref={section}>
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

// Tasks due by Friday that will not fit in the free work time before their due time, with the shortfall.
function AtRisk({ s, now }: { s: Split; now: number }) {
  const snap = useAssistantData();
  const { filter } = useView();
  const minute = Math.floor(now / 60000);
  const rows = useMemo(() => {
    const timed = live(snap.meetings).filter((m) => (filter === 'all' || m.profile === filter) && m.starts_at != null && m.ends_at != null && m.ends_at > m.starts_at && m.ends_at - m.starts_at < 20 * 3600_000);
    const blocked = new Set(timed.filter((m) => isBlock(m.id) && m.ends_at! > minute * 60000).map((m) => `${m.profile}:${m.id}`));
    const tasks = [...s.overdue, ...s.today, ...s.later].flatMap((r) => {
      const due = atTime(r.at);
      return due != null && !blocked.has(`${r.profile}:${blockId(r.id)}`) ? [{ title: r.title, due, r }] : [];
    });
    return atRisk(tasks, timed.map((m) => [m.starts_at!, m.ends_at!] as Span), minute * 60000);
  }, [snap.meetings, filter, s, minute]);
  if (!rows.length) return null;
  return (
    <section>
      <div className="as-section late">At risk · {rows.length}</div>
      <div className="ov-follow">
        {rows.map(({ task, short }) => (
          <div key={task.r.profile + task.r.id} className="ov-follow-row">
            <button className="ov-follow-text" onClick={() => setView({ list: 'tasks', open: null })}>
              <span className="ov-t">{task.r.title}</span>
              <span className="muted small">due {when(task.due, now)} · {minutesText(short)} short</span>
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

// The day at a glance: counts that open Tasks, the next meeting, today's and tomorrow's meetings, and what jobs reported today.
export function Overview({ s, dueToday, onPrep }: { s: Split; dueToday: ItemRow[]; onPrep: () => void }) {
  const store = useAssistantStore();
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
  const tasks = () => setView({ list: 'tasks', open: null });
  const stale = useMemo(() => staleTasks(snap.items.filter((r) => filter === 'all' || r.profile === filter), minute * 60000), [snap.items, filter, minute]);
  const stats = [
    { n: dueToday.length, label: 'to do today', sel: '.as-section:not(.late):not(.review):not(.later):not(.done)', cls: '' },
    { n: s.overdue.length, label: 'overdue', sel: '.as-section.late', cls: 'late' },
    { n: s.review.length, label: 'to confirm', sel: '.as-section.review', cls: 'review' },
    { n: stale.length, label: 'stale', sel: undefined, cls: '' },
  ].filter((x) => x.n > 0);
  const snooze = (r: ItemRow) => {
    haptic('tap');
    const at = nextNine(new Date(Math.max(atTime(r.at) ?? 0, now)));
    void store.update(r, { at, rolls: null, rolled_from: null }).then(() => showSnack(`Snoozed to ${when(at)}`));
  };
  const upcoming = s.meetingsToday.filter((m) => m !== s.next && (m.ends_at ?? m.starts_at!) > now);
  const left = meetingTimeLeft(s.meetingsToday, now, s.endOfDay);
  const leftText = left >= 60 ? `${Math.floor(left / 60)}h${left % 60 ? String(left % 60).padStart(2, '0') : ''}` : `${left} min`;
  const drag = !touch();
  const dueAt = (r: ItemRow) => {
    const t = atTime(r.at);
    return t != null && t >= startOfDay && t < s.endOfDay ? clock(t) : null;
  };
  const shown = (rs: ItemRow[], timed = false) => (
    <div className="ov-follow">
      {rs.slice(0, 5).map((r) => (
        <div key={r.profile + r.id} className="ov-follow-row" draggable={drag} onDragStart={drag ? (e) => e.dataTransfer.setData(DRAG_TYPE, `${r.profile}:${r.id}`) : undefined}>
          <button className="ov-check" aria-label={`Mark ${r.title} done`} onClick={() => { haptic('success'); act.done(r); }}><Icon name="circle-large-outline" small /></button>
          <button className="ov-follow-text" onClick={tasks}>
            <span className="ov-t">{r.title}</span>
            {timed && dueAt(r) && <span className="muted small">{dueAt(r)}</span>}
          </button>
          <button className="ov-check" aria-label={`Snooze ${r.title} to tomorrow`} title="Tomorrow 09:00" onClick={() => snooze(r)}><Icon name="clock" small /></button>
        </div>
      ))}
      {rs.length > 5 && <button className="ov-follow-row ov-follow-text muted" onClick={tasks}>+{rs.length - 5} more</button>}
    </div>
  );
  const sync = useSyncStatus();
  const loading = sync.syncing && !sync.last && !snap.items.length;
  const waiting = live(snap.chats).some((c) => c.kind === 'dm' && c.waiting === 1 && (filter === 'all' || c.profile === filter) && !stored<string[]>(WAIT_HANDLED, []).includes(waitKey(c)));
  const empty = !loading && !waiting && !s.overdue.length && !dueToday.length && !s.review.length && !s.meetingsToday.length && !s.meetingsTomorrow.length && !tomorrow.length;
  if (loading) return <Skeleton />;
  return (
    <>
      {stats.length > 0 && (
        <div className="ov-summary">
          {stats.map((x) => <button key={x.label} className={`ov-stat ${x.cls}`} onClick={() => x.sel ? setViewAt({ list: 'tasks', open: null }, x.sel) : tasks()}><b>{x.n}</b><span>{x.label}</span></button>)}
        </div>
      )}
      <GoalLines now={now} />
      <MorningBrief now={now} />
      <JustEnded meetings={s.meetingsToday} now={now} />
      <SinceMeeting now={now} />
      <Shutdown open={[...s.overdue, ...dueToday]} done={s.doneToday.length} now={now} />
      <DayPlan meetings={s.busyToday} open={dueToday} late={s.overdue} now={now} />
      <div className="as-next-actions">
        <button className="btn sm" onClick={() => copyText(standupText(snap.items.filter((r) => filter === 'all' || r.profile === filter), live(snap.meetings).filter((m) => filter === 'all' || m.profile === filter), [...s.overdue, ...dueToday], Date.now()), 'Standup copied')}><Icon name="copy" small /> Copy standup</button>
      </div>
      <AtRisk s={s} now={now} />
      <SinceLastVisit />
      <SlackCard />
      <WaitingOnYou />
      {s.review.length > 0 && (
        <section>
          <Review rows={s.review.slice(0, 3)} />
          {s.review.length > 3 && <button className="btn sm" onClick={tasks}>+{s.review.length - 3} more in Tasks</button>}
        </section>
      )}
      {digest && (
        <section>
          <div className="as-section">{digest.title} · {dayLabel(digest.updated_at, true)}</div>
          <div className="ov-report">{digest.text}</div>
        </section>
      )}
      {s.next && (
        <section>
          <div className="as-section next">Next</div>
          <NextCard m={s.next} then={s.then} carried={s.carried} onPrep={onPrep} />
        </section>
      )}
      {upcoming.length > 0 && (
        <section>
          <div className="as-section">Meetings today · {upcoming.length}{left > 0 && <span title="Meeting time left today, including the next one"> · {leftText} left</span>}</div>
          <div className="mt-rows ov-card">{upcoming.map((m) => <MeetingRow key={m.profile + m.id} m={m} now={now} />)}</div>
        </section>
      )}
      {s.overdue.length > 0 && (
        <section>
          <div className="as-section late">Overdue · {s.overdue.length}</div>
          {shown(s.overdue)}
        </section>
      )}
      {dueToday.length > 0 && (
        <section>
          <div className="as-section">To do today · {dueToday.length}</div>
          {shown(dueToday, true)}
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
      <KeepInTouch />
      {reports.map(({ j, r }) => (
        <section key={j.profile + j.id}>
          <button className="as-section as-toggle" onClick={() => setView({ list: 'jobs', open: `${j.profile}:${j.id}` })}>{j.name} · {clock(r.started_at!)}</button>
          <div className="ov-report">{r.output}</div>
        </section>
      ))}
      {empty && (
        <div className="ov-empty muted small">
          <div>Nothing today</div>
          {s.nextLater && <div>Next: {when(s.nextLater.starts_at!)} {s.nextLater.title}</div>}
        </div>
      )}
    </>
  );
}
