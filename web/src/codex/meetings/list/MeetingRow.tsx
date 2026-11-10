import { memo } from 'react';
import { type Meeting } from '../../data/wiki/wiki';
import { meetingBadge, meetingMeta } from '../../data/meetings/meetings';
import { MenuItem } from '../../../ui/Menu';
import { Row } from '../../../ui/Row';
import { safeHref } from '../../../ui/util';
import { openMeeting, openMeetingNotes } from '../../view';
import { ProfileDot } from '../../ProfileDot';
import { Badge } from '../../../ui/Badge';

const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

export function Avatars({ people, max = 3 }: { people: string[]; max?: number }) {
  if (!people.length) return null;
  const more = people.length - max;
  return (
    <span className="mt-avatars" title={people.join(', ')}>
      {people.slice(0, more > 0 ? max : people.length).map((p) => <span key={p}>{initials(p)}</span>)}
      {more > 0 && <span className="more">+{more}</span>}
    </span>
  );
}

export const MeetingRow = memo(function MeetingRow({ m, now, said, noDay }: { m: Meeting; now: number; said?: string; noDay?: boolean }) {
  const badge = meetingBadge(m, now);
  const calendar = m.id.startsWith('cal:') ? safeHref(m.calendar_url) : undefined;
  const open = () => openMeeting(m);
  return (
    <Row
      plain
      role="button"
      tabIndex={0}
      className={(m.ends_at ?? m.starts_at!) <= now ? 'past' : undefined}
      title={<><ProfileDot profile={m.profile} />{m.title}</>}
      meta={said ? <span className="mt-said" title="From the transcript">{said}</span> : meetingMeta(m, now, noDay)}
      state={badge ? <Badge status="running" label={badge} /> : null}
      menu={(
        <>
          {calendar && <MenuItem icon="calendar" href={calendar}>Open calendar</MenuItem>}
          <MenuItem icon="edit" onClick={() => openMeetingNotes(m)}>Notes</MenuItem>
        </>
      )}
      onClick={open}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } }}
    />
  );
});
