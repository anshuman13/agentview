import { useMemo } from 'react';
import { live, type Meeting } from '../../data/wiki/wiki';
import { dayEnd, dayLabel, dayStart } from '../../data/dates';
import { EmptyState } from '../../../ui/Panel';
import { Section, sectionCount } from '../../../ui/Section';
import { MeetingRow } from './MeetingRow';

// The coming week grouped by day, so the next working morning sits at the top.
export function ComingDays({ meetings, now }: { meetings: Meeting[]; now: number }) {
  const days = useMemo(() => {
    const today = dayStart(now), end = today + 7 * 86400_000;
    const out = new Map<number, Meeting[]>();
    for (const m of live(meetings).filter((x) => x.starts_at != null && (x.ends_at ?? x.starts_at) > now && x.starts_at < end).sort((a, b) => a.starts_at! - b.starts_at!)) {
      const d = Math.max(today, dayStart(m.starts_at!));
      out.set(d, [...(out.get(d) ?? []), m]);
    }
    return [...out];
  }, [meetings, now]);
  const label = (d: number) => d === dayStart(now) ? 'Today' : d === dayEnd(now) ? 'Tomorrow' : dayLabel(d, true);
  return (
    <>
      {days.map(([d, rows]) => (
        <section key={d}>
          <Section label={label(d)} count={sectionCount(rows.length)} />
          <div className="as-group">{rows.map((m) => <MeetingRow key={m.profile + m.id} m={m} now={now} noDay />)}</div>
        </section>
      ))}
      {!days.length && <EmptyState size="sm" icon="calendar" title="Nothing on the calendar this week" />}
    </>
  );
}
