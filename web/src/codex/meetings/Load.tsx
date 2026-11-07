import { useMemo } from 'react';
import { EmptyState } from '../../ui/Panel';
import { Row } from '../../ui/Row';
import { Section } from '../../ui/Section';
import { useAssistantTable } from '../data';
import { hoursText, meetingLoad } from '../data/load';
import { dayLabel } from '../data/dates';
import { seriesAudit } from '../data/seriesAudit';
import { openMeeting } from '../view';
import type { Meeting } from '../data/wiki';

export function Load({ meetings, now }: { meetings: Meeting[]; now: number }) {
  const items = useAssistantTable('items');
  const { weeks, people, series } = useMemo(() => meetingLoad(meetings, now, 4, items), [meetings, now, items]);
  const audit = useMemo(() => seriesAudit(meetings, items, now), [meetings, items, now]);
  const max = Math.max(...weeks.map((w) => w.hours), 1);
  const recorded = weeks.reduce((n, w) => n + w.recorded, 0);
  const total = recorded + weeks.reduce((n, w) => n + w.unrecorded, 0);
  if (!total) return <EmptyState size="sm" icon="calendar" title="No meetings in the last 4 weeks." />;
  return (
    <div className="mt-load">
      <div className="as-group">
        {weeks.map((w) => {
          const label = dayLabel(w.start, true).replace(',', '');
          return (
            <Row key={w.start} plain title={label}
              meta={<span className="mt-load-track"><i role="img" aria-label={`${label}: ${hoursText(w.hours)} in meetings`} style={{ width: `${(w.hours / max) * 100}%` }} /></span>}
              trailing={<span className="mt-load-num">{hoursText(w.hours)}</span>} />
          );
        })}
      </div>
      <div className="mt-load-share">{recorded} of {total} meetings recorded ({Math.round((recorded / total) * 100)}%)</div>
      {people.length > 0 && (
        <section>
          <Section label="Most time with" />
          <div className="as-group">
            {people.map((p) => <Row key={p.name} plain title={p.name} trailing={<span className="mt-load-num">{hoursText(p.hours)}</span>} />)}
          </div>
        </section>
      )}
      {series.length > 0 && (
        <section>
          <Section label="Time by series" />
          <div className="as-group">
            {series.map((s) => (
              <Row key={s.key} plain title={s.title}
                meta={s.total > 0 ? `done ${s.done} of ${s.total}${s.oldestOpen != null ? `, oldest open ${Math.max(Math.floor((now - s.oldestOpen) / 86_400_000), 0)}d` : ''}` : undefined}
                trailing={<span className="mt-load-num">{s.minutes} min ({s.change == null ? 'new' : `${s.change > 0 ? '+' : ''}${s.change}`})</span>} />
            ))}
          </div>
        </section>
      )}
      {audit.length > 0 && (
        <section>
          <Section label="Series value, last 8 weeks" />
          <div className="as-group">
            {audit.map((s) => (
              <Row key={s.key} title={s.title} onClick={() => openMeeting(s.latest)}
                meta={s.quiet ? `Nothing for you lately · ${hoursText(s.recentHours)} in 4 weeks` : `${s.count} meetings · ${hoursText(s.hours)} · ${s.decisions} decisions · ${s.actions} actions for me`}
                trailing={s.quiet && <span className="badge waiting">Quiet</span>} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
