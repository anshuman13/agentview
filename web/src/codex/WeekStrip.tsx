import { isBlock } from '../../../shared/util';
import { useAssistantData } from './data';
import { live } from './data/wiki';
import { heavyDay } from './days';
import { useView } from './view';

export type Chip = { key: string; day: number; count: number };

export function WeekStrip({ chips, today, onJump }: { chips: Chip[]; today: number; onJump: (key: string) => void }) {
  const snap = useAssistantData();
  const { filter } = useView();
  const meetings = live(snap.meetings).filter((m) => m.starts_at != null && !isBlock(m.id) && (filter === 'all' || m.profile === filter));
  return (
    <nav className="as-week" aria-label="Next seven days">
      {chips.map((c) => {
        const d = new Date(c.day);
        const heavy = heavyDay(meetings, c.day);
        return (
          <button key={c.key} className={`as-week-chip${c.day === today ? ' today' : ''}${c.count ? '' : ' zero'}`} disabled={!c.count} onClick={() => onJump(c.key)}
            aria-label={`${d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' })}, ${c.count} tasks${heavy ? ', busy with meetings' : ''}`}>
            <span className="as-week-dow">{d.toLocaleDateString([], { weekday: 'short' })}</span>
            <span className="as-week-num">{d.getDate()}</span>
            <span className="as-week-count">{c.count}</span>
            {heavy && <i className="as-week-dot" />}
          </button>
        );
      })}
    </nav>
  );
}
