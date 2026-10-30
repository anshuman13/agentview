import { useMemo } from 'react';
import { Icon } from '../../ui/Icon';
import { useAssistantData } from '../data';
import { hoursText, meetingLoad } from '../data/load';
import { dayLabel } from '../data/dates';
import { seriesAudit } from '../data/seriesAudit';
import { openMeeting } from '../view';
import type { Meeting } from '../data/wiki';

export function Load({ meetings, now }: { meetings: Meeting[]; now: number }) {
  const { items } = useAssistantData();
  const { weeks, people, series } = useMemo(() => meetingLoad(meetings, now, 4, items), [meetings, now, items]);
  const audit = useMemo(() => seriesAudit(meetings, items, now), [meetings, items, now]);
  const max = Math.max(...weeks.map((w) => w.hours), 1);
  const recorded = weeks.reduce((n, w) => n + w.recorded, 0);
  const total = recorded + weeks.reduce((n, w) => n + w.unrecorded, 0);
  if (!total) return <div className="as-empty"><Icon name="calendar" /><div>No meetings in the last 4 weeks.</div></div>;
  return (
    <div className="mt-load">
      <div className="mt-load-weeks">
        {weeks.map((w) => {
          const label = dayLabel(w.start, true).replace(',', '');
          return (
            <div key={w.start} className="mt-load-row">
              <span className="mt-load-label">{label}</span>
              <span className="mt-load-track"><i role="img" aria-label={`${label}: ${hoursText(w.hours)} in meetings`} style={{ width: `${(w.hours / max) * 100}%` }} /></span>
              <span className="mt-load-num">{hoursText(w.hours)}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-load-share">{recorded} of {total} meetings recorded ({Math.round((recorded / total) * 100)}%)</div>
      {people.length > 0 && (
        <div className="mt-load-people">
          <div className="mt-load-head">Most time with</div>
          {people.map((p) => <div key={p.name} className="mt-load-person"><span>{p.name}</span><span className="mt-load-num">{hoursText(p.hours)}</span></div>)}
        </div>
      )}
      {series.length > 0 && (
        <div className="mt-load-people">
          <div className="mt-load-head">Time by series</div>
          {series.map((s) => <div key={s.key} className="mt-load-person"><span>{s.title}{s.total > 0 && <span className="mt-load-num"> · done {s.done} of {s.total}{s.oldestOpen != null && `, oldest open ${Math.max(Math.floor((now - s.oldestOpen) / 86_400_000), 0)}d`}</span>}</span><span className="mt-load-num">{s.minutes} min ({s.change == null ? 'new' : `${s.change > 0 ? '+' : ''}${s.change}`})</span></div>)}
        </div>
      )}
      {audit.length > 0 && (
        <div className="mt-load-audit">
          <div className="mt-load-head">Series value, last 8 weeks</div>
          {audit.map((s) => (
            <button key={s.key} className="mt-log-item" onClick={() => openMeeting(s.latest)}>
              <span className="mt-log-text">{s.title}</span>
              <span className="mt-log-from">{s.count} meetings · {hoursText(s.hours)} · {s.decisions} decisions · {s.actions} actions for me</span>
              {s.quiet && <span className="mt-load-quiet"><Icon name="warning" small /> Nothing for you lately · {hoursText(s.recentHours)} in 4 weeks</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
