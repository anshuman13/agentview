import { useMemo, useState } from 'react';
import { Icon } from '../../ui/Icon';
import { decisionsMarkdown } from '../data/meetingMarkdown';
import { decisionLog, decisionsWith, peopleOf, type Meeting } from '../data/wiki';
import { when } from '../time';
import { setView, showSnack } from '../view';

export function Decisions({ meetings }: { meetings: Meeting[] }) {
  const [person, setPerson] = useState('');
  const log = useMemo(() => decisionLog(meetings), [meetings]);
  const people = useMemo(() => [...new Set(log.flatMap((d) => peopleOf(d.meeting)))].sort((a, b) => a.localeCompare(b)), [log]);
  const who = people.includes(person) ? person : '';
  const rows = decisionsWith(log, who);
  const copy = () => void navigator.clipboard.writeText(decisionsMarkdown(rows)).then(() => showSnack('Copied'), () => showSnack('Copy failed'));
  return (
    <div className="mt-log">
      {(people.length > 0 || rows.length > 0) && (
        <div className="mt-log-bar">
          {people.length > 0 && <select value={who} aria-label="Filter by person" onChange={(e) => setPerson(e.target.value)}>
            <option value="">Everyone</option>
            {people.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>}
          {rows.length > 0 && <button className="icon-btn" title="Copy as Markdown" aria-label="Copy as Markdown" onClick={copy}><Icon name="copy" /></button>}
        </div>
      )}
      {rows.map((d, i) => (
        <button key={`${d.meeting.profile}:${d.meeting.id}:${i}`} className="mt-log-item" onClick={() => setView({ list: 'meetings', open: `${d.meeting.profile}:${d.meeting.id}`, person: null })}>
          <span className="mt-log-text">{d.text}</span>
          <span className="mt-log-from">{d.meeting.title || 'Meeting'} · {when(d.at)}</span>
        </button>
      ))}
      {!rows.length && <div className="as-empty"><Icon name="check" /><div>{who ? 'No decisions with this person.' : 'No decisions yet.'}</div><div className="muted small">Decisions come from the meeting summaries.</div></div>}
    </div>
  );
}
