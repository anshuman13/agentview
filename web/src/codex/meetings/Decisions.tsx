import { useMemo, useState } from 'react';
import { Icon } from '../../ui/Icon';
import { Row } from '../../ui/Row';
import { EmptyState } from '../../ui/Panel';
import { decisionsMarkdown } from '../data/meetings/meetingMarkdown';
import { decisionLog, type Meeting } from '../data/wiki/wiki';
import { decisionsWith, peopleOf } from '../data/meetings/meetings';
import { when } from '../tasks/time';
import { copyText, openMeeting } from '../view';

export function Decisions({ meetings }: { meetings: Meeting[] }) {
  const [person, setPerson] = useState('');
  const log = useMemo(() => decisionLog(meetings), [meetings]);
  const people = useMemo(() => [...new Set(log.flatMap((d) => peopleOf(d.meeting)))].sort((a, b) => a.localeCompare(b)), [log]);
  const who = people.includes(person) ? person : '';
  const rows = decisionsWith(log, who);
  const copy = () => copyText(decisionsMarkdown(rows));
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
      {rows.length > 0 && (
        <div className="as-group">
          {rows.map((d, i) => <Row key={`${d.meeting.profile}:${d.meeting.id}:${i}`} lines={2} title={d.text} meta={`${d.meeting.title || 'Meeting'} · ${when(d.at)}`} onClick={() => openMeeting(d.meeting)} />)}
        </div>
      )}
      {!rows.length && <EmptyState size="sm" icon="check" title={who ? 'No decisions with this person' : 'No decisions yet'} hint="Decisions come from the meeting summaries" />}
    </div>
  );
}
