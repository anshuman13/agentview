import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAssistant, useCodex } from '../data';
import { ask, meetingAskText } from '../data/ask';
import { atTime, parseWhen, stripWhen } from '../data/engine';
import type { Patch } from '../data/store';
import type { ItemRow } from '../data/sync';
import { actionCount, actionsOf, groupMeetings, listOf, live, type Meeting } from '../data/wiki';
import { Icon } from '../../ui/Icon';
import { setView, showSnack, useEscapeBack, useView } from '../view';
import { AskBar } from '../wiki/Wiki';
import '../../styles/features/wiki.css';

const HUES = ['--accent', '--claude', '--prompt', '--ok', '--warn', '--agent'];
const hue = (name: string) => `var(${HUES[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % HUES.length]})`;
const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
export const peopleOf = (m: Meeting) => (m.people?.startsWith('[') ? listOf(m.people) : (m.people ?? '').split(',')).map((p) => p.trim()).filter(Boolean);
const meetingKey = (m: Meeting) => `${m.profile}:${m.id}`;
export const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

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

export function MeetingRow({ m, now }: { m: Meeting; now: number }) {
  const { snap } = useAssistant();
  const count = actionCount(snap.items, m);
  const live = m.starts_at! <= now && (m.ends_at ?? m.starts_at!) > now;
  const soon = !live && m.starts_at! > now && m.starts_at! - now < 3 * 3600_000;
  const mins = Math.round((m.starts_at! - now) / 60000);
  return (
    <button className="mt-row" onClick={() => setView({ list: 'meetings', open: meetingKey(m) })}>
      <span className="mt-time"><b>{clock(m.starts_at!)}</b>{m.ends_at && <span>{clock(m.ends_at)}</span>}</span>
      <span className="mt-body">
        <span className="mt-title">{m.title}{live && <span className="mt-badge live">Now</span>}{soon && <span className="mt-badge">in {mins < 60 ? `${mins} min` : `${Math.round(mins / 60)} h`}</span>}</span>
        <span className="wk-meta">
          {m.recorded_ms ? <span><Icon name="record" small /> {Math.round(m.recorded_ms / 60000)} min</span> : null}
          {m.summary && <span>Summary</span>}
          {m.starts_at! >= new Date(now).setHours(24, 0, 0, 0) && <span>{new Date(m.starts_at!).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}</span>}
          {!m.recorded_ms && !m.summary && <span>{peopleOf(m).length} people</span>}
        </span>
      </span>
      {count.review > 0 ? <span className="mt-count review" title="Suggested actions to keep or dismiss">{count.review} to review</span> : count.total > 0 && (
        <span className={`mt-count${count.done === count.total ? ' done' : ''}`} title="My actions done">
          <Icon name={count.done === count.total ? 'pass' : 'circle-large-outline'} small /> {count.done} of {count.total}
        </span>
      )}
      <Avatars people={peopleOf(m)} />
    </button>
  );
}

function MeetingsList({ onMenu }: { onMenu: () => void }) {
  const { meetings, store } = useCodex();
  const { filter } = useView();
  const [query, setQuery] = useState('');
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
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const mine = filter === 'all' ? meetings : meetings.filter((m) => m.profile === filter);
    const shown = words.length ? mine.filter((m) => words.every((w) => [m.title, m.people, m.notes, m.summary].map((x) => x ?? '').join(' ').toLowerCase().includes(w))) : mine;
    return groupMeetings(shown, now);
  }, [meetings, query, filter, now]);
  const takeNotes = () => {
    const t = Date.now();
    const id = crypto.randomUUID();
    const row: Meeting = {
      id, profile: filter === 'personal' ? 'personal' : 'work', version: 0, updated_at: t, deleted: 0, dirty: 1, field_times: '{}',
      title: 'Notes', starts_at: t, ends_at: null, people: null, calendar_url: null, recorded_ms: null, notes: '', summary: null, decisions: null,
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
        <button className="btn mt-cal" disabled={syncing} title="Import the next days from Google Calendar (runs on its own every hour from 8 to 14 on weekdays)" onClick={syncCalendar}>
          <Icon name={syncing ? 'loading' : 'sync'} small spin={syncing} /> <span>{syncing ? 'Syncing' : 'Sync calendar'}</span>
        </button>
        <button className="btn primary mt-take" onClick={takeNotes}><Icon name="edit" small /> <span>Take notes</span></button>
      </header>
      <div className="wk-scroll">
        <div className="mt-list">
          {groups.map((g) => (
            <section key={g.label}>
              <div className="wk-label">{g.label}</div>
              <div className="mt-rows">{g.rows.map((m) => <MeetingRow key={m.profile + m.id} m={m} now={now} />)}</div>
            </section>
          ))}
          {!groups.length && <div className="as-empty"><Icon name="calendar" /><div>{query ? 'No meetings match.' : 'No meetings yet.'}</div></div>}
        </div>
      </div>
    </div>
  );
}

const openMeeting = (r: ItemRow) => setView({ list: 'meetings', open: `${r.profile}:${r.meeting_id}` });

// One of my actions from a meeting. A suggested one is kept as a task in Today or dismissed.
export function ActionRow({ row, showMeeting = false }: { row: ItemRow; showMeeting?: boolean }) {
  const { store } = useAssistant();
  const change = (patch: Patch, text: string) => {
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, k === 'deleted' ? 0 : row[k as keyof ItemRow]])) as Patch;
    void store.update(row, patch);
    showSnack(text, () => void store.update(row, before));
  };
  const suggested = row.status === 'suggested';
  const done = row.status === 'done';
  const at = atTime(row.at);
  return (
    <div className={`mt-task ${row.status ?? ''}`}>
      {!suggested && (
        <button className="as-check" title={done ? 'Not done' : 'Done'} aria-label={done ? 'Not done' : 'Done'} onClick={() => change({ status: done ? 'open' : 'done' }, done ? 'Moved back to Today' : 'Done')}>
          <Icon name={done ? 'pass-filled' : 'circle-large-outline'} />
        </button>
      )}
      <div className="mt-task-body">
        <div className="mt-task-title">{row.title}</div>
        <div className="as-ctx">
          {showMeeting && row.meeting_id && <button className="mt-task-from" onClick={() => openMeeting(row)}><Icon name="calendar" small /> {row.people || 'Meeting'}</button>}
          {at != null && !done && <span className={at < Date.now() ? 'as-due late' : 'as-due'}>{new Date(at).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
          {row.text && <span className="mt-task-why">{row.text}</span>}
        </div>
      </div>
      {suggested && (
        <div className="mt-task-pick">
          <button className="icon-btn" title="Not mine" aria-label="Dismiss" onClick={() => change({ deleted: 1 }, 'Dismissed')}><Icon name="close" /></button>
          <button className="btn sm primary" onClick={() => change({ status: 'open' }, 'Added to Today')}><Icon name="check" small /> Mine</button>
        </div>
      )}
    </div>
  );
}

const ORDER: Record<string, number> = { suggested: 0, open: 1, done: 2 };

function MeetingActions({ m }: { m: Meeting }) {
  const { store, snap } = useAssistant();
  const [text, setText] = useState('');
  const rows = actionsOf(snap.items, m).sort((a, b) => (ORDER[a.status ?? ''] ?? 3) - (ORDER[b.status ?? ''] ?? 3) || a.updated_at - b.updated_at);
  const add = () => {
    const t = text.trim();
    if (!t) return;
    const w = parseWhen(t);
    void store.capture(stripWhen(t, w) || t, 'task', m.profile, w?.at ?? null, { id: m.id, title: m.title });
    setText('');
  };
  return (
    <>
      {rows.length > 0 && <div className="mt-tasks">{rows.map((r) => <ActionRow key={r.profile + r.id} row={r} />)}</div>}
      {!rows.length && <p className="mt-pending">Your action items from the transcript land here and in Today.</p>}
      <form className="mt-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <Icon name="add" small />
        <input value={text} placeholder="Add an action, like “send the slides friday”" aria-label="Add an action" onChange={(e) => setText(e.target.value)} />
      </form>
    </>
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

function TranscriptButton({ m }: { m: Meeting }) {
  const { store } = useCodex();
  const [busy, setBusy] = useState(false);
  if (!m.id.startsWith('cal:') || !m.starts_at || m.starts_at > Date.now()) return null;
  const run = async () => {
    setBusy(true);
    try {
      showSnack((await store.fetchTranscript(m)) ? 'Summary updated from the transcript' : 'No transcript found yet');
    } catch (err) {
      showSnack(`Transcript sync failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className="btn sm mt-sync" disabled={busy} title="Read the transcript again: summary and suggested actions" onClick={run}>
      <Icon name={busy ? 'loading' : 'sync'} small spin={busy} /> {busy ? 'Syncing' : 'Sync transcript'}
    </button>
  );
}

function MeetingPage({ m }: { m: Meeting }) {
  const { snap } = useAssistant();
  const mine = actionsOf(snap.items, m);
  const count = actionCount(snap.items, m);
  const decisions = listOf(m.decisions);
  const people = peopleOf(m);
  const back = () => setView({ open: null });
  useEscapeBack(back);
  const day = m.starts_at ? new Date(m.starts_at).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }) : '';
  return (
    <div className="wk narrow">
      <header className="wk-head">
        <button className="icon-btn" title="Back to meetings" aria-label="Back" onClick={back}><Icon name="arrow-left" /></button>
        <nav className="wk-crumbs"><button onClick={back}>Meetings</button></nav>
        <span className="spacer" />
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
          {people.length > 0 && <div className="mt-people"><Avatars people={people} max={5} /><span>{people.slice(0, 3).join(', ')}{people.length > 3 ? ` and ${people.length - 3} more` : ''}</span></div>}

          <section className="mt-sec">
            <h2>My notes</h2>
            <Notes key={meetingKey(m)} m={m} />
          </section>

          <section className="mt-sec">
            <h2><Icon name="sparkle" small /> Summary<TranscriptButton m={m} /></h2>
            {m.summary ? <p className="mt-summary">{m.summary}</p> : <p className="mt-pending">The summary and your action items are written from the transcript after the meeting.</p>}
          </section>

          {decisions.length > 0 && (
            <section className="mt-sec">
              <h2>Decisions</h2>
              <ul className="mt-decisions">{decisions.map((d) => <li key={d}>{d}</li>)}</ul>
            </section>
          )}

          <section className="mt-sec">
            <h2>My actions{count.total > 0 && <span className="mt-of">{count.done} of {count.total} done</span>}</h2>
            <MeetingActions m={m} />
          </section>
        </article>
      </div>
      <AskBar placeholder="Ask about this meeting" onAsk={(q) => ask(meetingAskText(q, m, mine))} />
    </div>
  );
}

export function Meetings({ onMenu }: { onMenu: () => void }) {
  const { open } = useView();
  const { meetings } = useCodex();
  const rows = live(meetings);
  const m = open ? rows.find((x) => meetingKey(x) === open) ?? rows.find((x) => x.id === open) : undefined;
  if (m) return <MeetingPage m={m} />;
  return <MeetingsList onMenu={onMenu} />;
}
