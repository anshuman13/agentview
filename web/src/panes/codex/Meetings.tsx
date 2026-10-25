import { useMemo, useState } from 'react';
import { useCodex } from '../../assistant';
import { actionCount, groupMeetings, live, type Meeting } from '../../assistant/wiki';
import { Icon } from '../../Icon';
import { setView, useView } from './view';
import '../../styles/features/wiki.css';

const HUES = ['--accent', '--claude', '--prompt', '--ok', '--warn', '--agent'];
const hue = (name: string) => `var(${HUES[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % HUES.length]})`;
const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
export const peopleOf = (m: Meeting) => (m.people ?? '').split(',').map((p) => p.trim()).filter(Boolean);
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

function Row({ m, now }: { m: Meeting; now: number }) {
  const { actions } = useCodex();
  const count = actionCount(actions, m.id);
  const live = m.starts_at! <= now && (m.ends_at ?? m.starts_at!) > now;
  const soon = !live && m.starts_at! > now && m.starts_at! - now < 3 * 3600_000;
  const mins = Math.round((m.starts_at! - now) / 60000);
  return (
    <button className="mt-row" onClick={() => setView({ open: m.id })}>
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
  const { meetings, store, sample } = useCodex();
  const [query, setQuery] = useState('');
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
  return (
    <div className="wk narrow">
      <header className="wk-head">
        <button className="icon-btn as-menu" title="Lists" aria-label="Lists" onClick={onMenu}><Icon name="menu" /></button>
        <h1>Meetings</h1>
        {sample && <span className="wk-sample" title="The scheduler fills meetings from Calendar; until then this is sample data">Sample</span>}
        <span className="spacer" />
        <label className="wk-search">
          <Icon name="search" small />
          <input value={query} placeholder="Search" aria-label="Search meetings" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery('')} />
        </label>
        <button className="btn primary mt-take" onClick={takeNotes}><Icon name="edit" small /> <span>Take notes</span></button>
      </header>
      <div className="wk-scroll">
        <div className="mt-list">
          {groups.map((g) => (
            <section key={g.label}>
              <div className="wk-label">{g.label}</div>
              <div className="mt-rows">{g.rows.map((m) => <Row key={m.profile + m.id} m={m} now={now} />)}</div>
            </section>
          ))}
          {!groups.length && <div className="as-empty"><Icon name="calendar" /><div>{query ? 'No meetings match.' : 'No meetings yet.'}</div></div>}
        </div>
      </div>
    </div>
  );
}

export function Meetings({ onMenu }: { onMenu: () => void }) {
  const { open } = useView();
  const { meetings } = useCodex();
  const m = open ? live(meetings).find((x) => x.id === open) : undefined;
  if (open) {
    return (
      <div className="wk">
        <header className="wk-head">
          <button className="icon-btn" title="Back" aria-label="Back" onClick={() => setView({ open: null })}><Icon name="arrow-left" /></button>
          <h1>{m?.title}</h1>
        </header>
      </div>
    );
  }
  return <MeetingsList onMenu={onMenu} />;
}
