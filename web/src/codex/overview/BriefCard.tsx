import { useMemo } from 'react';
import { useAssistantTable } from '../data';
import { rowKey } from '../data/sync';
import type { Brief } from '../data/wiki';
import { IconButton } from '../../ui/Button';
import { Row } from '../../ui/Row';
import { Section } from '../../ui/Section';
import { clock } from '../time';
import { openMeeting, openTask } from '../view';
import { GroupList, WaitingLine, useWaiting } from './DigestCard';
import type { BriefRow, DigestGroup } from './digest';

type Parsed = { groups: DigestGroup<BriefRow>[]; waiting: BriefRow[] };

const counted = (groups: DigestGroup<BriefRow>[], section: string, noun: string) => {
  const n = groups.find((g) => g.outcome === section)?.rows.length ?? 0;
  return n > 0 && <span className="badge quiet">{n} {noun}{n === 1 ? '' : 's'}</span>;
};

// The morning brief as a report card: meeting and task counts in the header, one open or folded list per section, and a link to the Reply queue for the asks that still wait.
export function BriefCard({ brief, parsed, showProfile, onDismiss }: { brief: Brief; parsed: Parsed; showProfile: boolean; onDismiss: () => void }) {
  const { profile } = brief;
  const itemRows = useAssistantTable('items');
  const meetingRows = useAssistantTable('meetings');
  const items = useMemo(() => new Set(itemRows.filter((r) => !r.deleted).map(rowKey)), [itemRows]);
  const meetings = useMemo(() => new Set(meetingRows.filter((r) => !r.deleted).map(rowKey)), [meetingRows]);
  const waiting = useWaiting(brief, parsed.waiting.map((r) => r.item));
  const target = (r: BriefRow) => {
    if (r.item && items.has(rowKey({ profile, id: r.item }))) return () => openTask({ profile, id: r.item });
    if (r.meeting && meetings.has(rowKey({ profile, id: r.meeting }))) return () => openMeeting({ profile, id: r.meeting });
  };
  return (
    <section className="ov-digest">
      <Section label={`${brief.text}${showProfile ? ` · ${profile}` : ''}`} action={(
        <span className="ov-digest-head">
          {counted(parsed.groups, 'meetings', 'meeting')}
          {counted(parsed.groups, 'tasks', 'task')}
          <span>{clock(brief.to_at ?? brief.from_at!)}</span>
          <IconButton icon="close" label="Hide until tomorrow" size="sm" onClick={onDismiss} />
        </span>
      )} />
      <div className="ov-group">
        {parsed.groups.map((g) => (
          <GroupList key={g.outcome} brief={brief} group={g} render={(r) => {
            const onClick = target(r);
            return (
              <div className="ov-digest-row">
                <Row disabled={!onClick} title={r.title} meta={r.meta} onClick={onClick} />
              </div>
            );
          }} />
        ))}
        <WaitingLine count={waiting} />
      </div>
    </section>
  );
}
