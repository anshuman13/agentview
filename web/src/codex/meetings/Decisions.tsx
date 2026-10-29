import { useMemo, useState } from 'react';
import { Icon } from '../../ui/Icon';
import { decisionLog, decisionsWith, peopleOf, type Meeting } from '../data/wiki';
import { when } from '../time';
import { setView } from '../view';

export function Decisions({ meetings }: { meetings: Meeting[] }) {
  const [person, setPerson] = useState('');
  const log = useMemo(() => decisionLog(meetings), [meetings]);
  const people = useMemo(() => [...new Set(log.flatMap((d) => peopleOf(d.meeting)))].sort((a, b) => a.localeCompare(b)), [log]);
  const rows = decisionsWith(log, person);
  return (
    <div className="mt-log">
      {people.length > 0 && (
        <div className="mt-log-bar">
          <select value={person} aria-label="Filter by person" onChange={(e) => setPerson(e.target.value)}>
            <option value="">Everyone</option>
            {people.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      )}
      {rows.map((d, i) => (
        <button key={`${d.meeting.profile}:${d.meeting.id}:${i}`} className="mt-log-item" onClick={() => setView({ list: 'meetings', open: `${d.meeting.profile}:${d.meeting.id}`, person: null })}>
          <span className="mt-log-text">{d.text}</span>
          <span className="mt-log-from">{d.meeting.title || 'Meeting'} · {when(d.at)}</span>
        </button>
      ))}
      {!rows.length && <div className="as-empty"><Icon name="check" /><div>{person ? 'No decisions with this person.' : 'No decisions yet.'}</div><div className="muted small">Decisions come from the meeting summaries.</div></div>}
    </div>
  );
}
