import { useMemo } from 'react';
import { Icon } from '../../ui/Icon';
import { meetingLoad } from '../data/load';
import type { Meeting } from '../data/wiki';

const hoursText = (h: number) => `${h.toFixed(1)} h`;

export function Load({ meetings, now }: { meetings: Meeting[]; now: number }) {
  const { weeks, people, series } = useMemo(() => meetingLoad(meetings, now), [meetings, now]);
  const max = Math.max(...weeks.map((w) => w.hours), 1);
  const recorded = weeks.reduce((n, w) => n + w.recorded, 0);
  const total = recorded + weeks.reduce((n, w) => n + w.unrecorded, 0);
  if (!total) return <div className="as-empty"><Icon name="calendar" /><div>No meetings in the last 4 weeks.</div></div>;
  return (
    <div className="mt-load">
      <div className="mt-load-weeks">
        {weeks.map((w) => {
          const label = new Date(w.start).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
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
          {series.map((s) => <div key={s.key} className="mt-load-person"><span>{s.title}</span><span className="mt-load-num">{s.minutes} min ({s.change == null ? 'new' : `${s.change > 0 ? '+' : ''}${s.change}`})</span></div>)}
        </div>
      )}
    </div>
  );
}
