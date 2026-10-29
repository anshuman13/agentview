import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAssistant, useCodex } from '../data';
import { ask, meetingAskText } from '../data/ask';
import { followUpText, hasContent, toMarkdown } from '../data/meetingMarkdown';
import { atTime, parseWhen, stripWhen } from '../data/engine';
import type { AssistantStore, Patch } from '../data/store';
import { SUMMARY_TEMPLATES, summaryInstructions, type SummaryTemplate } from '../data/summaryTemplates';
import { newId, type ItemRow } from '../data/sync';
import { TRANSCRIPT_TRIES as TRIES, actionCount, actionCounts, actionsOf, groupMeetings, listOf, live, meetingState, othersOf, peopleOf, searchMeetings, trackedTopics, type Meeting } from '../data/wiki';
import { PickTime, clock, when } from '../time';
import { Icon } from '../../ui/Icon';
import { save, stored } from '../../ui/util';
import { Voice, useDictation } from '../../chat/Voice';
import { setView, showSnack, useEscapeBack, useView } from '../view';
import { AskBar } from '../wiki/Wiki';
import { Person } from './Person';
import '../../styles/features/wiki.css';

const HUES = ['--accent', '--claude', '--prompt', '--ok', '--warn', '--agent'];
const hue = (name: string) => `var(${HUES[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % HUES.length]})`;
const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
export { peopleOf };
const TOPICS_KEY = 'agentview.meetingTopics';
const meetingKey = (m: Meeting) => `${m.profile}:${m.id}`;

export function Avatars({ people, max = 3 }: { people: string[]; max?: number }) {
  if (!people.length) return null;
  const more = people.length - max;
  return (
    <span className="mt-avatars" title={people.join(', ')}>
      {people.slice(0, more > 0 ? max : people.length).map((p) => <span key={p} style={{ '--hue': hue(p) } as React.CSSProperties}>{initials(p)}</span>)}
      {more > 0 && <span className="more">+{more}</span>}
    </span>
  );
}

// The badge says where the meeting is: coming up, waiting for its transcript, or what it left for me.
const Badge = memo(function Badge({ m, now, review, total, done }: { m: Meeting; now: number; review: number; total: number; done: number }) {
  const state = meetingState(m, now);
  if (state === 'missing') return <span className="mt-count warn" title="No Gemini notes were found for this meeting">No transcript</span>;
  if (review > 0) return <span className="mt-count review" title="Suggested actions to keep or dismiss">{review} to review</span>;
  if (total > 0) {
    return (
      <span className={`mt-count${done === total ? ' done' : ''}`} title="My actions done">
        <Icon name={done === total ? 'pass' : 'circle-large-outline'} small /> {done} of {total}
      </span>
    );
  }
  if (state === 'waiting') return <span className="mt-count muted" title="The transcript is read a few minutes after the meeting">Waiting</span>;
  if (state === 'done') return <span className="mt-count muted">Nothing for you</span>;
  return null;
});

const NO_TOPICS: string[] = [];

export const MeetingRow = memo(function MeetingRow({ m, now, topics = NO_TOPICS }: { m: Meeting; now: number; topics?: string[] }) {
  const { snap } = useAssistant();
  const count = actionCounts(snap.items).get(meetingKey(m)) ?? actionCount([], m);
  return <MeetingRowView m={m} now={now} topics={topics} review={count.review} total={count.total} done={count.done} />;
});

const MeetingRowView = memo(function MeetingRowView({ m, now, topics, review, total, done }: { m: Meeting; now: number; topics: string[]; review: number; total: number; done: number }) {
  const tracked = useMemo(() => trackedTopics(m, topics), [m, topics]);
  const people = useMemo(() => peopleOf(m), [m]);
  const live = m.starts_at! <= now && (m.ends_at ?? m.starts_at!) > now;
  const soon = !live && m.starts_at! > now && m.starts_at! - now < 3 * 3600_000;
  const mins = Math.round((m.starts_at! - now) / 60000);
  return (
    <button className={`mt-row${(m.ends_at ?? m.starts_at!) <= now ? ' past' : ''}`} onClick={() => setView({ list: 'meetings', open: meetingKey(m), person: null })}>
      <span className="mt-tile"><Icon name={m.id.startsWith('cal:') ? 'calendar' : 'edit'} /></span>
      <span className="mt-body">
        <span className="mt-title">{m.title}{live && <span className="mt-badge live">Now</span>}{soon && <span className="mt-badge">in {mins < 60 ? `${mins} min` : `${Math.round(mins / 60)} h`}</span>}</span>
        <span className="mt-span">
          {m.starts_at! >= new Date(now).setHours(24, 0, 0, 0) && `${new Date(m.starts_at!).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, `}
          {clock(m.starts_at!)}{m.ends_at ? ` - ${clock(m.ends_at)}` : ''}
          {m.recorded_ms ? ` · ${Math.round(m.recorded_ms / 60000)} min recorded` : ''}
        </span>
      </span>
      {tracked.map((t) => <span key={t} className="chip pill sm" title="Tracked topic">{t}</span>)}
      <Badge m={m} now={now} review={review} total={total} done={done} />
      <Avatars people={people} />
    </button>
  );
});

const dayStart = (t: number) => new Date(t).setHours(0, 0, 0, 0);

// Today, then each later day with meetings, one at a time, like a desk calendar.
function Upcoming({ meetings, now, topics }: { meetings: Meeting[]; now: number; topics: string[] }) {
  const [at, setAt] = useState(0);
  const days = useMemo(() => {
    const today = dayStart(now);
    const out = new Map<number, Meeting[]>([[today, []]]);
    for (const m of live(meetings).filter((x) => x.starts_at != null && (x.ends_at ?? x.starts_at) > now).sort((a, b) => a.starts_at! - b.starts_at!)) {
      const d = Math.max(today, dayStart(m.starts_at!));
      out.set(d, [...(out.get(d) ?? []), m]);
    }
    return [...out];
  }, [meetings, now]);
  const i = Math.min(at, days.length - 1);
  const [day, rows] = days[i];
  const isToday = day === dayStart(now);
  return (
    <section className="mt-upcoming">
      <div className="mt-up-head">
        <span>Upcoming</span>
        <span className="spacer" />
        <button className="icon-btn" title="Earlier day" aria-label="Earlier day" disabled={i === 0} onClick={() => setAt(i - 1)}><Icon name="chevron-left" small /></button>
        <button className="icon-btn" title="Next day with meetings" aria-label="Next day" disabled={i === days.length - 1} onClick={() => setAt(i + 1)}><Icon name="chevron-right" small /></button>
      </div>
      <div className="mt-up-card">
        <div className="mt-up-date">
          <b>{new Date(day).getDate()}</b>
          <span>{isToday ? 'Today' : new Date(day).toLocaleDateString([], { weekday: 'short', month: 'short' })}</span>
          {isToday && <i className="mt-up-dot" />}
        </div>
        <div className="mt-up-rows">
          {rows.map((m) => <MeetingRow key={m.profile + m.id} m={m} now={now} topics={topics} />)}
          {!rows.length && <div className="mt-up-none">{days.length > 1 ? 'Nothing else today.' : 'Nothing on the calendar.'}</div>}
        </div>
      </div>
    </section>
  );
}

function TopicBar({ topics, active, onToggle, onAdd, onRemove }: { topics: string[]; active: string[]; onToggle: (t: string) => void; onAdd: (t: string) => void; onRemove: (t: string) => void }) {
  const [text, setText] = useState('');
  return (
    <div className="mt-topics">
      {topics.map((t) => (
        <span key={t} className="mt-topic">
          <button className={`chip pill${active.includes(t) ? '' : ' outline'}`} aria-pressed={active.includes(t)} title="Show only meetings on this topic" onClick={() => onToggle(t)}>{t}</button>
          <button className="icon-btn" title={`Stop tracking ${t}`} aria-label={`Stop tracking ${t}`} onClick={() => onRemove(t)}><Icon name="close" small /></button>
        </span>
      ))}
      <form onSubmit={(e) => { e.preventDefault(); onAdd(text.trim().toLowerCase()); setText(''); }}>
        <input value={text} placeholder="Track a topic" aria-label="Track a topic" onChange={(e) => setText(e.target.value)} />
      </form>
    </div>
  );
}

function MeetingsList({ onMenu }: { onMenu: () => void }) {
  const { meetings, store } = useCodex();
  const { filter } = useView();
  const [query, setQuery] = useState('');
  const [topics, setTopics] = useState(() => stored<string[]>(TOPICS_KEY, []).filter((t) => typeof t === 'string'));
  const [active, setActive] = useState<string[]>([]);
  const changeTopics = (next: string[]) => {
    setTopics(next);
    setActive((a) => a.filter((t) => next.includes(t)));
    save(TOPICS_KEY, next);
  };
  const [syncing, setSyncing] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const shown = () => document.visibilityState === 'visible' && tick();
    const t = setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', shown);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', shown);
    };
  }, []);
  const groups = useMemo(() => {
    const mine = filter === 'all' ? meetings : meetings.filter((m) => m.profile === filter);
    const tracked = active.length ? mine.filter((m) => trackedTopics(m, active).length) : mine;
    return groupMeetings(searchMeetings(tracked, query), now);
  }, [meetings, query, filter, now, active]);
  const takeNotes = () => {
    const t = Date.now();
    const id = newId();
    const row: Meeting = {
      id, profile: filter === 'personal' ? 'personal' : 'work', version: 0, updated_at: t, deleted: 0, dirty: 1, field_times: '{}',
      title: 'Notes', starts_at: t, ends_at: null, people: null, calendar_url: null, recorded_ms: null, notes: '', summary: null, decisions: null, transcript: null, tries: null, room: null, room_me: null, others: null,
    };
    void store.editRow('meetings', row, { title: 'Notes', starts_at: t, notes: '' });
    setView({ open: meetingKey(row) });
  };
  const syncCalendar = async () => {
    setSyncing(true);
    try {
      const n = await store.syncCalendar();
      showSnack(n ? `${n} meeting${n > 1 ? 's' : ''} updated from the calendar` : 'Calendar is up to date');
    } catch (err) {
      showSnack(`Calendar sync failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSyncing(false);
    }
  };
  return (
    <div className="wk narrow">
      <header className="wk-head">
        <button className="icon-btn as-menu" title="Lists" aria-label="Lists" onClick={onMenu}><Icon name="menu" /></button>
        <h1>Meetings</h1>
        <span className="spacer" />
        <label className="wk-search">
          <Icon name="search" small />
          <input value={query} placeholder="Search" aria-label="Search meetings" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery('')} />
        </label>
        <button className="btn mt-cal" disabled={syncing} title="Import the next days from Google Calendar (runs on its own every half hour from 7 to 19 on weekdays, and when the app opens)" onClick={syncCalendar}>
          <Icon name={syncing ? 'loading' : 'sync'} small spin={syncing} /> <span>{syncing ? 'Syncing' : 'Sync calendar'}</span>
        </button>
        <button className="btn primary mt-take" onClick={takeNotes}><Icon name="edit" small /> <span>Take notes</span></button>
      </header>
      <div className="wk-scroll">
        <div className="mt-list">
          <TopicBar topics={topics} active={active} onToggle={(t) => setActive((a) => (a.includes(t) ? a.filter((x) => x !== t) : [...a, t]))}
            onAdd={(t) => t && !topics.includes(t) && changeTopics([...topics, t])} onRemove={(t) => changeTopics(topics.filter((x) => x !== t))} />
          {!query && <Upcoming meetings={filter === 'all' ? meetings : meetings.filter((m) => m.profile === filter)} now={now} topics={topics} />}
          {groups.map((g) => (
            <section key={g.label}>
              <div className="mt-day">{g.label}</div>
              <div className="mt-days">{g.rows.map((m) => <MeetingRow key={m.profile + m.id} m={m} now={now} topics={topics} />)}</div>
            </section>
          ))}
          {!groups.length && <div className="as-empty"><Icon name="calendar" /><div>{query ? 'No meetings match.' : 'No past meetings yet.'}</div><div className="muted small">{query ? 'Search covers titles, people, notes, summaries, decisions and transcripts.' : 'Coming meetings are in Today and Upcoming.'}</div></div>}
        </div>
      </div>
    </div>
  );
}

const openMeeting = (r: ItemRow) => setView({ list: 'meetings', open: `${r.profile}:${r.meeting_id}` });

export function confirmAll(store: AssistantStore, rows: ItemRow[]) {
  for (const r of rows) void store.update(r, { status: 'open' });
  showSnack(`${rows.length} added to Today`, () => rows.forEach((r) => void store.update(r, { status: r.status })));
}

// An action from a meeting. Suggested ones are kept (Today) or dismissed (Not mine, on the meeting); unassigned ones
// can be taken; dismissed ones restored. Each open one has a date chip.
export function ActionRow({ row, showMeeting = false }: { row: ItemRow; showMeeting?: boolean }) {
  const { store } = useAssistant();
  const change = (patch: Patch, text: string) => {
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, row[k as keyof ItemRow]])) as Patch;
    void store.update(row, patch);
    showSnack(text, () => void store.update(row, before));
  };
  const status = row.status ?? '';
  const mine = status === 'open' || status === 'done';
  const done = status === 'done';
  const at = atTime(row.at);
  return (
    <div className={`mt-task ${status}`}>
      {mine && (
        <button className="as-check" title={done ? 'Not done' : 'Done'} aria-label={done ? 'Not done' : 'Done'} onClick={() => change({ status: done ? 'open' : 'done' }, done ? 'Moved back to Today' : 'Done')}>
          <Icon name={done ? 'pass-filled' : 'circle-large-outline'} />
        </button>
      )}
      <div className="mt-task-body">
        <div className="mt-task-title">{row.title}</div>
        <div className="as-ctx">
          {showMeeting && row.meeting_id && <button className="mt-task-from" onClick={() => openMeeting(row)}><Icon name="calendar" small /> {row.people || 'Meeting'}</button>}
          {(status === 'open' || status === 'suggested') && (
            <PickTime className={`mt-date${at != null && at < Date.now() ? ' late' : ''}`} value={at} title="Set a date" label={at != null ? when(at) : 'Date'}
              onPick={(t) => change({ at: t }, `Due ${when(t)}`)} />
          )}
          {row.text && <span className="mt-task-why">{row.text}</span>}
        </div>
      </div>
      {status === 'suggested' && (
        <div className="mt-task-pick">
          <button className="mt-no" title="Not mine" aria-label="Not mine" onClick={() => change({ status: 'dismissed' }, 'Moved to Not mine')}><Icon name="close" small /></button>
          <button className="mt-yes" title="Mine, add to Today" aria-label="Mine, add to Today" onClick={() => change({ status: 'open' }, 'Added to Today')}><Icon name="check" small /></button>
        </div>
      )}
      {status === 'unassigned' && <button className="btn sm" onClick={() => change({ status: 'open' }, 'Added to Today')}>Take it</button>}
      {status === 'dismissed' && <button className="btn sm" onClick={() => change({ status: 'suggested' }, 'Back to review')}>Restore</button>}
    </div>
  );
}

const ORDER: Record<string, number> = { open: 0, done: 1 };

function Fold({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!count) return null;
  return (
    <section className="mt-sec mt-fold">
      <button className="mt-fold-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{title} · {count} <Icon name={open ? 'chevron-up' : 'chevron-down'} small /></button>
      {open && children}
    </section>
  );
}

function AddAction({ m }: { m: Meeting }) {
  const { store } = useAssistant();
  const [text, setText] = useState('');
  const dictate = useDictation(text, setText);
  const add = () => {
    const t = text.trim();
    if (!t) return;
    const w = parseWhen(t);
    void store.capture(stripWhen(t, w) || t, 'task', m.profile, w?.at ?? null, { id: m.id, title: m.title });
    setText('');
  };
  return (
    <form className="mt-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
      <Icon name="add" small />
      <input value={text} placeholder="Add an action, like “send the slides friday”" aria-label="Add an action" onChange={(e) => setText(e.target.value)} />
      <Voice onText={dictate} />
    </form>
  );
}

const SAVE_AFTER = 800;

// Saves while you type, and before the page hides or the meeting closes; takes synced notes while the field is not focused.
function Notes({ m }: { m: Meeting }) {
  const { store } = useCodex();
  const [text, setText] = useState(m.notes ?? '');
  const area = useRef<HTMLTextAreaElement>(null);
  const row = useRef(m);
  row.current = m;
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const t = pending.current;
    pending.current = null;
    if (t !== null && t !== (row.current.notes ?? '')) void store.editRow('meetings', row.current, { notes: t });
  }, [store]);
  useEffect(() => {
    const hidden = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);
  useEffect(() => {
    if (pending.current === null && document.activeElement !== area.current) setText(m.notes ?? '');
  }, [m.notes]);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);
  const change = (value: string) => {
    setText(value);
    pending.current = value;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_AFTER);
  };
  return (
    <textarea ref={area} className="mt-notes" value={text} rows={2} placeholder="Write your notes. They stay yours; the summary is written separately."
      onChange={(e) => change(e.target.value)} onBlur={flush} />
  );
}

function SummaryFormat({ m }: { m: Meeting }) {
  const { store } = useCodex();
  const [busy, setBusy] = useState(false);
  if (!m.id.startsWith('cal:') || !m.starts_at || m.starts_at > Date.now()) return null;
  const choose = async (key: SummaryTemplate) => {
    setBusy(true);
    try {
      await store.fetchTranscript(m, summaryInstructions(key));
      showSnack(`Summary rewritten as ${SUMMARY_TEMPLATES[key].label}`);
    } catch (err) {
      showSnack(`Summary failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <select className="mt-sync" value="" disabled={busy} aria-label="Summary format" title="Summary format" onChange={(e) => void choose(e.target.value as SummaryTemplate)}>
      <option value="" disabled>{busy ? 'Rewriting' : 'Summary format'}</option>
      {(Object.keys(SUMMARY_TEMPLATES) as SummaryTemplate[]).map((k) => <option key={k} value={k}>{SUMMARY_TEMPLATES[k].label}</option>)}
    </select>
  );
}

function TranscriptButton({ m, label }: { m: Meeting; label: string }) {
  const { store } = useCodex();
  const [busy, setBusy] = useState(false);
  if (!m.id.startsWith('cal:') || !m.starts_at || m.starts_at > Date.now()) return null;
  const run = async () => {
    setBusy(true);
    try {
      showSnack((await store.fetchTranscript(m)) ? 'Read the transcript' : 'No transcript found yet');
    } catch (err) {
      showSnack(`Transcript sync failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className="btn sm mt-sync" disabled={busy} title="Read the transcript: summary and actions" onClick={run}>
      <Icon name={busy ? 'loading' : 'sync'} small spin={busy} /> {busy ? 'Reading' : label}
    </button>
  );
}

// One line on where the meeting is, so an empty action list always has a reason.
function StateLine({ m, now }: { m: Meeting; now: number }) {
  const { store, snap } = useAssistant();
  const c = actionCount(snap.items, m);
  const others = othersOf(m).length;
  const state = meetingState(m, now);
  const parts: string[] = [];
  if (state === 'upcoming') parts.push(`Starts ${when(m.starts_at!, now)}`);
  if (state === 'live') parts.push('In progress');
  if (state === 'waiting') parts.push(m.tries ? `Waiting for the transcript · try ${m.tries} of ${TRIES}` : 'Waiting for the transcript');
  if (state === 'missing') parts.push('No Gemini notes found for this meeting');
  if (state === 'done') {
    parts.push(c.total ? `${c.total} for you` : 'Nothing for you');
    if (c.review) parts.push(`${c.review} to review`);
    if (others) parts.push(`${others} others took`);
    if (c.unassigned) parts.push(`${c.unassigned} unassigned`);
  }
  if (!parts.length) return null;
  return (
    <div className={`mt-state ${state}`}>
      <span>{parts.join(' · ')}</span>
      {(state === 'waiting' || state === 'missing') && <TranscriptButton m={m} label={state === 'missing' ? 'Retry' : 'Read now'} />}
      {state === 'missing' && <button className="btn sm" title="Nothing to add for this meeting" onClick={() => void store.editRow('meetings', m, { transcript: 'done' })}>Dismiss</button>}
    </div>
  );
}

// The room microphone speaks for whoever sits in the room; asked once per meeting, a yes reads the transcript again with
// that speaker as me.
function RoomMic({ m }: { m: Meeting }) {
  const { store } = useCodex();
  const [busy, setBusy] = useState(false);
  if (!m.room || m.room_me != null) return null;
  const yes = async () => {
    setBusy(true);
    await store.editRow('meetings', m, { room_me: 1 });
    await store.syncNow();
    try {
      const { error } = store.snapshot().sync;
      if (error) throw new Error(`the room mic answer did not sync: ${error}`);
      await store.fetchTranscript(m);
      showSnack('Read again with the room mic as you');
    } catch (err) {
      showSnack(`Transcript sync failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-room">
      <Icon name="mic" />
      <span>Were you on the room mic, <b>{m.room}</b>?</span>
      <button className="btn sm" disabled={busy} onClick={() => void store.editRow('meetings', m, { room_me: 0 })}>No</button>
      <button className="btn sm primary" disabled={busy} onClick={yes}>{busy ? 'Reading' : 'Yes, me'}</button>
    </div>
  );
}

function CopyButtons({ m, actions }: { m: Meeting; actions: ItemRow[] }) {
  if (!hasContent(m, actions)) return null;
  const copy = (text: string, done: string) => void navigator.clipboard.writeText(text).then(() => showSnack(done), () => showSnack('Copy failed'));
  return (
    <>
      <button className="icon-btn" title="Copy as Markdown" aria-label="Copy as Markdown" onClick={() => copy(toMarkdown(m, actions), 'Copied')}><Icon name="copy" /></button>
      <button className="icon-btn" title="Copy a follow-up draft" aria-label="Copy a follow-up draft" onClick={() => copy(followUpText(m, actions), 'Follow-up copied')}><Icon name="mail" /></button>
    </>
  );
}

function MeetingPage({ m }: { m: Meeting }) {
  const { snap, store } = useAssistant();
  const all = actionsOf(snap.items, m);
  const by = (st: string) => all.filter((r) => r.status === st);
  const mine = all.filter((r) => r.status === 'open' || r.status === 'done').sort((a, b) => (ORDER[a.status ?? ''] ?? 2) - (ORDER[b.status ?? ''] ?? 2) || a.updated_at - b.updated_at);
  const review = by('suggested');
  const count = actionCount(snap.items, m);
  const others = othersOf(m);
  const decisions = listOf(m.decisions);
  const people = peopleOf(m);
  const now = Date.now();
  const state = meetingState(m, now);
  const back = () => setView({ open: null });
  useEscapeBack(back);
  const day = m.starts_at ? new Date(m.starts_at).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }) : '';
  return (
    <div className="wk narrow">
      <header className="wk-head">
        <button className="icon-btn" title="Back to meetings" aria-label="Back" onClick={back}><Icon name="arrow-left" /></button>
        <nav className="wk-crumbs"><button onClick={back}>Meetings</button></nav>
        <span className="spacer" />
        <CopyButtons m={m} actions={all} />
        {state === 'done' && <TranscriptButton m={m} label="Read again" />}
        {m.calendar_url && <a className="btn sm" href={m.calendar_url} target="_blank" rel="noreferrer"><Icon name="calendar" small /> Calendar</a>}
      </header>
      <div className="wk-scroll">
        <article className="mt-page">
          <h1 className="wk-title">{m.title}</h1>
          <div className="wk-meta mt-when">
            <span>{day}</span>
            {m.starts_at && <span>{clock(m.starts_at)}{m.ends_at ? `–${clock(m.ends_at)}` : ''}</span>}
            {m.recorded_ms ? <span><Icon name="record" small /> Recorded {Math.round(m.recorded_ms / 60000)} min</span> : null}
          </div>
          {people.length > 0 && <div className="mt-people"><Avatars people={people} max={5} /><span>{people.slice(0, 3).map((p, i) => <span key={p}>{i > 0 && ', '}<button className="mt-person" onClick={() => setView({ person: p })}>{p}</button></span>)}{people.length > 3 ? ` and ${people.length - 3} more` : ''}</span></div>}
          <StateLine m={m} now={now} />
          <RoomMic m={m} />

          <section className="mt-sec">
            <h2>My actions{count.total > 0 && <span className="mt-of">{count.done} of {count.total} done</span>}</h2>
            {mine.length > 0 && <div className="mt-tasks">{mine.map((r) => <ActionRow key={r.profile + r.id} row={r} />)}</div>}
            {!mine.length && !review.length && (
              <p className="mt-pending">{state === 'missing' ? 'No transcript. Add actions below.' : state === 'done' ? 'Nothing for you in the transcript.' : 'Your actions from the transcript land here and in Today.'}</p>
            )}
            <AddAction m={m} />
          </section>

          {review.length > 0 && (
            <section className="mt-sec">
              <h2>To review<span className="mt-of">{review.length}</span>{review.length > 1 && <button className="btn sm mt-sync" onClick={() => confirmAll(store, review)}><Icon name="check-all" small /> Confirm all</button>}</h2>
              <div className="mt-tasks">{review.map((r) => <ActionRow key={r.profile + r.id} row={r} />)}</div>
            </section>
          )}

          <section className="mt-sec">
            <h2><Icon name="sparkle" small /> Summary{m.summary && <SummaryFormat m={m} />}</h2>
            {m.summary ? <p className="mt-summary">{m.summary}</p> : <p className="mt-pending">{state === 'missing' ? 'No summary without a transcript.' : 'Written from the transcript after the meeting.'}</p>}
          </section>

          {decisions.length > 0 && (
            <section className="mt-sec">
              <h2>Decisions</h2>
              <ul className="mt-decisions">{decisions.map((d) => <li key={d}>{d}</li>)}</ul>
            </section>
          )}

          <section className="mt-sec">
            <h2>My notes</h2>
            <Notes key={meetingKey(m)} m={m} />
          </section>

          <Fold title="Unassigned" count={count.unassigned}>
            <div className="mt-tasks">{by('unassigned').map((r) => <ActionRow key={r.profile + r.id} row={r} />)}</div>
          </Fold>
          <Fold title="Others took" count={others.length}>
            <ul className="mt-others">{others.map((o, i) => <li key={i}><b>{o.who}</b> {o.what}</li>)}</ul>
          </Fold>
          <Fold title="Not mine" count={count.dismissed}>
            <div className="mt-tasks">{by('dismissed').map((r) => <ActionRow key={r.profile + r.id} row={r} />)}</div>
          </Fold>
        </article>
      </div>
      <AskBar placeholder="Ask about this meeting" onAsk={(q) => ask(meetingAskText(q, m, all))} />
    </div>
  );
}

export function Meetings({ onMenu }: { onMenu: () => void }) {
  const { open, person } = useView();
  const { meetings } = useCodex();
  const rows = live(meetings);
  const m = open ? rows.find((x) => meetingKey(x) === open) ?? rows.find((x) => x.id === open) : undefined;
  if (person) return <Person name={person} />;
  if (m) return <MeetingPage m={m} />;
  return <MeetingsList onMenu={onMenu} />;
}
