import { useMemo, useRef, useState } from 'react';
import { useAssistantStore, useAssistantData, useCodex, useSyncStatus } from './data';
import { live, type Chat, type Meeting } from './data/wiki';
import { actionsOf, displayName, followThrough, meetingState } from './data/meetings';
import { followUpText } from './data/meetingMarkdown';
import { meetingTimeLeft, sinceLastVisit } from './data/load';
import { resolvedQuestions } from './meetings/OpenQuestions';
import { atTime, errorText, latestDigest, latestRunByJob, nextNine, staleTasks } from './data/engine';
import { isSaid, type ItemRow } from './data/sync';
import { ago, safeHref, save, stored, plural } from '../ui/util';
import { dayLabel } from './data/dates';
import { Prep } from './meetings/Prep';
import { Shutdown } from './Shutdown';
import { NeedsYou, useNeedsYou } from './NeedsYou';
import { channelOf, sourceOf } from './taskSource';
import { unrollFor, useActions } from './useActions';
import { DayPlan, DRAG_TYPE } from './DayPlan';
import { GoalLines } from './Goals';
import { atRisk, minutesText, type Span } from './data/plan';
import { keepInTouch, standupText, touchText, type Lapsed } from './data/review';
import { blockId, isBlock } from '../../../shared/util';
import { MorningBrief } from './Brief';
import { Capped, Fold } from './Fold';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { haptic } from '../ui/haptic';
import { copyText, focusPast, openMeeting, openTask, setView, showSnack, useView } from './view';
import { ActionRow, MeetingRow, confirmAll, dismissAll, peopleOf } from './meetings/Meetings';
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
        {g.length > 1 && <button className="as-dismiss-all" onClick={() => dismissAll(store, g)}><Icon name="close" small /> Dismiss all {g.length}</button>}
      </div>
    </section>
  ));
}

const DISMISSED = 'agentview:followThrough';

// Open actions from meetings over a week old: Task unlinks one from its meeting so it is a plain task, Dismiss hides it here.
function useFollowThrough() {
  const snap = useAssistantData();
  const { meetings } = useCodex();
  const { filter } = useView();
  const [dismissed, setDismissed] = useState<string[]>(() => stored<string[]>(DISMISSED, []));
  const minute = Math.floor(Date.now() / 60000);
  const rows = useMemo(
    () => followThrough(snap.items, meetings.filter((m) => filter === 'all' || m.profile === filter), dismissed, minute * 60000),
    [snap.items, meetings, filter, dismissed, minute],
  );
  const dismiss = (r: ItemRow) => {
    const live = new Set(snap.items.filter((x) => !x.deleted && x.meeting_id).map((x) => x.profile + x.id));
    const next = [...new Set([...dismissed, r.profile + r.id])].filter((k) => live.has(k));
    setDismissed(next);
    save(DISMISSED, next);
  };
  return { rows, dismiss };
}

function FollowThrough({ f }: { f: ReturnType<typeof useFollowThrough> }) {
  const store = useAssistantStore();
  const act = useActions();
  const section = useRef<HTMLElement>(null);
  const { rows } = f;
  const dismiss = (r: ItemRow) => { f.dismiss(r); focusPast(section.current); };
  if (!rows.length) return null;
  return (
    <section ref={section}>
      <div className="as-section">Follow-through · {rows.length}</div>
      <div className="ov-follow">
        <Capped items={rows} render={({ r, m }) => (
          <div key={r.profile + r.id} className="ov-follow-row">
            <button className="ov-follow-text" onClick={() => openMeeting(m)}>
              <span className="ov-t">{r.title}</span>
              <span className="muted small">{m.title} · {dayLabel(m.starts_at!)}</span>
            </button>
            <button className="btn sm" aria-label={`Make ${r.title} a plain task`} onClick={() => void store.update(r, { meeting_id: null })}>Task</button>
            <button className="btn sm" aria-label={`Mark ${r.title} done`} onClick={() => { haptic('success'); act.done(r); focusPast(section.current); }}>Done</button>
            <button className="btn sm" aria-label={`Dismiss ${r.title}`} onClick={() => dismiss(r)}>Dismiss</button>
          </div>
        )} />
      </div>
    </section>
  );
}

const TOUCH_DISMISSED = 'codex.keepInTouch';

// People I usually meet or DM who have gone quiet for over 1.5x their usual gap: Copy nudge copies a short line, Dismiss hides them until the next contact.
function useKeepInTouch() {
  const snap = useAssistantData();
  const { filter } = useView();
  const [dismissed, setDismissed] = useState<string[]>(() => stored<string[]>(TOUCH_DISMISSED, []));
  const hour = Math.floor(Date.now() / 3600_000);
  const rows = useMemo(() => {
    const pick = <T extends { profile: string }>(xs: T[]) => xs.filter((x) => filter === 'all' || x.profile === filter);
    // The current time, as a contact from this hour would be past an hour-rounded now and not count.
    return keepInTouch(pick(snap.meetings), pick(snap.chats), pick(snap.items), Date.now());
  }, [snap.meetings, snap.chats, snap.items, filter, hour]);
  const shown = rows.filter((x) => !dismissed.includes(x.key));
  const dismiss = (x: Lapsed) => {
    const next = [...(filter === 'all' ? dismissed.filter((k) => rows.some((r) => r.key === k)) : dismissed), x.key];
    setDismissed(next);
    save(TOUCH_DISMISSED, next);
  };
  return { shown, dismiss };
}

function KeepInTouch({ k }: { k: ReturnType<typeof useKeepInTouch> }) {
  const list = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const { shown } = k;
  const dismiss = (x: Lapsed, i: number) => {
    k.dismiss(x);
    // Focus the person that moved into this row, or the one above when the last went.
    requestAnimationFrame(() => {
      const people = list.current?.querySelectorAll<HTMLElement>('button.ov-follow-text');
      people?.[Math.min(i, people.length - 1)]?.focus();
    });
    focusPast(section.current);
  };
  if (!shown.length) return null;
  return (
    <section ref={section}>
      <div className="as-section">Keep in touch · {shown.length}</div>
      <div className="ov-follow" role="list" aria-label="Keep in touch" ref={list}>
        <Capped items={shown} render={(x, i) => (
          <div key={x.key} className="ov-follow-row wrap" role="listitem">
            <button className="ov-follow-text" onClick={() => setView({ person: x.name })}>
              <span className="ov-t">{displayName(x.name)}</span>
              <span className="muted small">last {dayLabel(x.last)} · usually every {plural(Math.max(1, Math.round(x.gap / 86400000)), 'day')}</span>
            </button>
            <button className="btn sm" aria-label={`Copy a nudge to ${x.name}`} onClick={() => copyText(touchText(x.name), 'Nudge copied')}><Icon name="copy" small /> Copy nudge</button>
            <button className="btn sm" aria-label={`Dismiss ${x.name}`} onClick={() => dismiss(x, i)}>Dismiss</button>
          </div>
        )} />
      </div>
    </section>
  );
}

const JUST_ENDED_MS = 2 * 3600_000;
const ACTIONS_SHOWN = 3;

// Meetings that ended in the last two hours, with their actions, a follow-up draft to copy and the notes.
function JustEnded({ meetings, now }: { meetings: Meeting[]; now: number }) {
  const snap = useAssistantData();
  const ended = meetings.filter((m) => m.ends_at != null && m.ends_at <= now && now - m.ends_at < JUST_ENDED_MS);
  if (!ended.length) return null;
  return ended.map((m) => {
    const actions = actionsOf(snap.items, m).filter((r) => r.status === 'open');
    const copy = () => copyText(followUpText(m, actions), 'Follow-up copied');
    return (
      <section key={m.profile + m.id}>
        <div className="as-section">Just ended · {m.title}</div>
        {actions.length > 0 && (
          <div className="as-group">
            {actions.slice(0, ACTIONS_SHOWN).map((r) => <ActionRow key={r.profile + r.id} row={r} />)}
            {actions.length > ACTIONS_SHOWN && <button className="as-confirm-all" onClick={() => openMeeting(m)}>Open notes for {actions.length - ACTIONS_SHOWN} more</button>}
          </div>
        )}
        <div className="as-next-actions">
          {!actions.length && meetingState(m, now) === 'waiting' && <span className="muted small ov-follow-text">Waiting for the transcript</span>}
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

const firstLine = (text: string | null | undefined) => (text ?? '').split('\n').find((l) => l.trim())?.trim() ?? '';

function Stale({ rows, now, snooze }: { rows: ItemRow[]; now: number; snooze: (r: ItemRow) => void }) {
  const act = useActions();
  if (!rows.length) return null;
  return (
    <section>
      <div className="as-section">Stale · {rows.length}</div>
      <div className="ov-follow">
        <Capped items={rows} render={(r) => (
          <div key={r.profile + r.id} className="ov-follow-row">
            <button className="ov-follow-text" onClick={() => openTask(r)}>
              <span className="ov-t">{r.title}</span>
              <span className="muted small">untouched {Math.floor((now - r.updated_at) / 86400000)} days</span>
            </button>
            <button className="ov-check" aria-label={`Mark ${r.title} done`} onClick={() => { haptic('success'); act.done(r); }}><Icon name="circle-large-outline" small /></button>
            <button className="ov-check" aria-label={`Snooze ${r.title} to tomorrow`} title="Tomorrow 09:00" onClick={() => snooze(r)}><Icon name="clock" small /></button>
          </div>
        )} />
      </div>
    </section>
  );
}

// The day at a glance: what needs me, the next meeting, today's meetings and tasks, with later items and job reports in folds.
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
  const needs = useNeedsYou(s, now);
  const stale = useMemo(() => {
    const late = new Set(s.overdue.map((r) => r.profile + r.id));
    const shownElsewhere = (r: ItemRow) => { const t = atTime(r.at); return t != null && t < s.endOfTomorrow; };
    return staleTasks(snap.items.filter((r) => (filter === 'all' || r.profile === filter) && !r.meeting_id && !late.has(r.profile + r.id) && !shownElsewhere(r)), minute * 60000);
  }, [snap.items, s.overdue, s.endOfTomorrow, filter, minute]);
  const follow = useFollowThrough();
  const touchRows = useKeepInTouch();
  const morning = new Date(now).getHours() < 11;
  const snooze = (r: ItemRow) => {
    haptic('tap');
    const at = nextNine(new Date(Math.max(atTime(r.at) ?? 0, now)), r.profile);
    void store.update(r, { at, ...unrollFor(at) }).then(() => showSnack(`Snoozed to ${when(at)}`));
  };
  const risky = new Set(needs.rows.flatMap((n) => (n.kind === 'risk' ? [n.row.profile + n.row.id] : [])));
  const todo = dueToday.filter((r) => !risky.has(r.profile + r.id));
  const upcoming = s.meetingsToday.filter((m) => m !== s.next && (m.ends_at ?? m.starts_at!) > now);
  const laterCount = stale.length + follow.rows.length + touchRows.shown.length + s.meetingsTomorrow.length + tomorrow.length;
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
  const sync = useSyncStatus();
  const loading = sync.syncing && !sync.last && !snap.items.length;
  const empty = !loading && !needs.rows.length && !s.overdue.length && !dueToday.length && !s.review.length && !s.next && !upcoming.length && !s.meetingsTomorrow.length && !tomorrow.length;
  if (loading) return <Skeleton />;
  return (
    <>
      <GoalLines now={now} />
      <MorningBrief now={now} />
      <JustEnded meetings={s.meetingsToday} now={now} />
      <NeedsYou n={needs} now={now} />
      <Shutdown open={[...s.overdue, ...dueToday]} done={s.doneToday.length} now={now} />
      <DayPlan meetings={s.busyToday} open={dueToday} late={s.overdue} now={now} />
      {morning && (
        <div className="as-next-actions">
          <button className="btn sm" onClick={standup}><Icon name="copy" small /> Copy standup</button>
        </div>
      )}
      {morning && <SinceLastVisit />}
      {s.next && (
        <section>
          <div className="as-section next">Next</div>
          <NextCard m={s.next} then={s.then} carried={s.carried} onPrep={onPrep} />
        </section>
      )}
      {upcoming.length > 0 && (
        <section>
          <div className="as-section">Meetings today · {upcoming.length}{left > 0 && <span title="Meeting time left today, including the next one"> · {leftText} left</span>}</div>
          <div className="mt-rows ov-card">{upcoming.slice(0, 3).map((m) => <MeetingRow key={m.profile + m.id} m={m} now={now} />)}</div>
          {upcoming.length > 3 && <button className="as-chip quiet ov-more" onClick={() => setView({ list: 'meetings', open: null })}>+{upcoming.length - 3} more</button>}
        </section>
      )}
      {todo.length > 0 && (
        <section>
          <div className="as-section">To do today · {todo.length}</div>
          {shown(todo, true)}
        </section>
      )}
      <Fold id="later" title="Later" count={laterCount}>
        <Stale rows={stale} now={now} snooze={snooze} />
        <FollowThrough f={follow} />
        <KeepInTouch k={touchRows} />
        {(s.meetingsTomorrow.length > 0 || tomorrow.length > 0) && (
          <section>
            <div className="as-section later">Tomorrow</div>
            {s.meetingsTomorrow.length > 0 && <div className="mt-rows ov-card">{s.meetingsTomorrow.map((m) => <MeetingRow key={m.profile + m.id} m={m} now={now} />)}</div>}
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
      {empty && (
        <div className="ov-empty muted small">
          <div>Nothing today</div>
          {s.nextLater && <div>Next: {when(s.nextLater.starts_at!)} {s.nextLater.title}</div>}
        </div>
      )}
    </>
  );
}
