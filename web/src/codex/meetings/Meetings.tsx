import { useEffect, useMemo, useRef, useState } from 'react';
import { useCodex } from '../data';
import { ask, meetingAskText } from '../data/ask';
import { actionCount, fieldsOf, groupMeetings, listOf, live, type Action, type Meeting } from '../data/wiki';
import { Icon } from '../../ui/Icon';
import { setView, showSnack, useEscapeBack, useView } from '../view';
import { AskBar } from '../wiki/Wiki';
import '../../styles/features/wiki.css';

const HUES = ['--accent', '--claude', '--prompt', '--ok', '--warn', '--agent'];
const hue = (name: string) => `var(${HUES[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % HUES.length]})`;
const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
export const peopleOf = (m: Meeting) => (m.people?.startsWith('[') ? listOf(m.people) : (m.people ?? '').split(',')).map((p) => p.trim()).filter(Boolean);
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
  const { actions } = useCodex();
  const count = actionCount(actions, m.id);
  const live = m.starts_at! <= now && (m.ends_at ?? m.starts_at!) > now;
  const soon = !live && m.starts_at! > now && m.starts_at! - now < 3 * 3600_000;
  const mins = Math.round((m.starts_at! - now) / 60000);
  return (
    <button className="mt-row" onClick={() => setView({ list: 'meetings', open: m.id })}>
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
      {count.total > 0 && (
        <span className={`mt-count${count.handled === count.total ? ' done' : ''}`} title="Actions handled">
          <Icon name={count.handled === count.total ? 'pass' : 'circle-large-outline'} small /> {count.handled} of {count.total}
        </span>
      )}
      <Avatars people={peopleOf(m)} />
    </button>
  );
}

function MeetingsList({ onMenu }: { onMenu: () => void }) {
  const { meetings, store } = useCodex();
  const [query, setQuery] = useState('');
  const [syncing, setSyncing] = useState(false);
  const now = Date.now();
  const groups = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = words.length ? meetings.filter((m) => words.every((w) => `${m.title} ${m.people} ${m.notes} ${m.summary}`.toLowerCase().includes(w))) : meetings;
    return groupMeetings(shown, now);
  }, [meetings, query]);
  const takeNotes = () => {
    const t = Date.now();
    const id = crypto.randomUUID();
    const row: Meeting = {
      id, profile: 'work', version: 0, updated_at: t, deleted: 0, dirty: 1, field_times: '{}',
      title: 'Notes', starts_at: t, ends_at: null, people: null, calendar_url: null, recorded_ms: null, notes: '', summary: null, decisions: null,
    };
    void store.editRow('meetings', row, { title: 'Notes', starts_at: t, notes: '' });
    setView({ open: id });
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
        <button className="btn" disabled={syncing} title="Import the next days from Google Calendar (runs on its own every hour from 8 to 14 on weekdays)" onClick={syncCalendar}>
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

const KIND: Record<string, { icon: string; label: (target: string) => string }> = {
  slack: { icon: 'comment-discussion', label: (t) => `Slack message to ${t}` },
  linear: { icon: 'issues', label: (t) => `Linear issue in ${t}` },
  task: { icon: 'pass', label: () => 'Task in Codex' },
};

function ActionCard({ a }: { a: Action }) {
  const { store } = useCodex();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(a.title ?? '');
  const [body, setBody] = useState(a.body ?? '');
  const kind = KIND[a.kind ?? ''] ?? { icon: 'circle-small', label: (t: string) => t };
  const set = (status: string, text: string) => {
    const before = a.status;
    void store.editRow('actions', a, { status });
    showSnack(text, () => void store.editRow('actions', a, { status: before }));
  };
  const save = () => {
    void store.editRow('actions', a, { title: title.trim() || a.title, body });
    setEditing(false);
  };
  if (a.status === 'rejected') {
    return (
      <div className="mt-action rejected">
        <Icon name={kind.icon} small /><s>{a.title}</s><span className="spacer" />
        <button className="wk-act" onClick={() => void store.editRow('actions', a, { status: 'proposed' })}>Restore</button>
      </div>
    );
  }
  const fields = Object.entries(fieldsOf(a));
  return (
    <div className={`mt-action ${a.status}`}>
      <div className="mt-action-kind"><span className={`mt-kind ${a.kind}`}><Icon name={kind.icon} small /></span>{kind.label(a.target ?? '')}</div>
      {editing ? (
        <div className="mt-action-edit">
          <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
          <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Text" />
        </div>
      ) : (
        <>
          <div className="mt-action-title">{a.title}</div>
          {a.body && <div className="mt-action-body">{a.body}</div>}
        </>
      )}
      {fields.length > 0 && <div className="mt-fields">{fields.map(([k, v]) => <span key={k}><em>{k}</em> {v}</span>)}</div>}
      <div className="mt-action-foot">
        {a.status === 'proposed' && !editing && (
          <>
            <button className="wk-act" onClick={() => setEditing(true)}><Icon name="edit" small /> Edit</button>
            <span className="spacer" />
            <button className="icon-btn mt-reject" title="Reject" aria-label="Reject" onClick={() => set('rejected', 'Action rejected')}><Icon name="close" /></button>
            <button className="btn primary mt-approve" onClick={() => set('approved', 'Approved')}><Icon name="check" small /> Approve</button>
          </>
        )}
        {editing && (
          <>
            <span className="spacer" />
            <button className="btn" onClick={() => { setEditing(false); setTitle(a.title ?? ''); setBody(a.body ?? ''); }}>Cancel</button>
            <button className="btn primary" onClick={save}>Save</button>
          </>
        )}
        {a.status === 'approved' && (
          <>
            <span className="mt-state"><Icon name="pass-filled" small /> Approved</span>
            <span className="mt-wait">{a.kind === 'task' ? 'Added when the scheduler runs' : 'Sends when the scheduler runs'}</span>
            <span className="spacer" />
            <button className="wk-act" onClick={() => void store.editRow('actions', a, { status: 'proposed' })}>Undo</button>
          </>
        )}
        {a.status === 'sent' && (
          <>
            <span className="mt-state"><Icon name="pass-filled" small /> Sent</span>
            {a.result_url && <a className="wk-act" href={a.result_url} target="_blank" rel="noreferrer">Open <Icon name="link-external" small /></a>}
          </>
        )}
      </div>
    </div>
  );
}

function Notes({ m }: { m: Meeting }) {
  const { store } = useCodex();
  const [text, setText] = useState(m.notes ?? '');
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);
  return (
    <textarea ref={area} className="mt-notes" value={text} rows={2} placeholder="Write your notes. They stay yours; the summary is written separately."
      onChange={(e) => setText(e.target.value)} onBlur={() => text !== (m.notes ?? '') && void store.editRow('meetings', m, { notes: text })} />
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
    <button className="btn sm mt-sync" disabled={busy} title="Read the Gemini notes and transcript for this meeting" onClick={run}>
      <Icon name={busy ? 'loading' : 'sync'} small spin={busy} /> {busy ? 'Syncing' : 'Sync transcript'}
    </button>
  );
}

function MeetingPage({ m }: { m: Meeting }) {
  const { actions } = useCodex();
  const mine = live(actions).filter((a) => a.meeting_id === m.id);
  const count = actionCount(actions, m.id);
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
            <Notes key={m.id} m={m} />
          </section>

          <section className="mt-sec">
            <h2><Icon name="sparkle" small /> Summary<TranscriptButton m={m} /></h2>
            {m.summary ? <p className="mt-summary">{m.summary}</p> : <p className="mt-pending">The summary is written from the Gemini transcript up to 30 minutes after the meeting.</p>}
          </section>

          {decisions.length > 0 && (
            <section className="mt-sec">
              <h2>Decisions</h2>
              <ul className="mt-decisions">{decisions.map((d) => <li key={d}>{d}</li>)}</ul>
            </section>
          )}

          <section className="mt-sec">
            <h2>Actions{count.total > 0 && <span className="mt-of">{count.handled} of {count.total}</span>}</h2>
            {mine.length ? <div className="mt-actions">{mine.map((a) => <ActionCard key={a.profile + a.id} a={a} />)}</div>
              : <p className="mt-pending">Proposed Slack messages, Linear issues and tasks appear here after the meeting.</p>}
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
  const m = open ? live(meetings).find((x) => x.id === open) : undefined;
  if (m) return <MeetingPage m={m} />;
  return <MeetingsList onMenu={onMenu} />;
}
