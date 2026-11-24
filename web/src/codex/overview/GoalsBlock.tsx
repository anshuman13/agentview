import { goalAtRisk, goalNext, goalProgress, goalsLine, goalsOf } from '../data/tasks/goals';
import { timedMeetings, weekFreeMinutes, type Span } from '../data/tasks/plan';
import type { ItemRow } from '../data/sync';
import { live, type Meeting } from '../data/wiki/wiki';
import { openWeekGoals, type Filter } from '../view';
import { Icon } from '../../ui/Icon';
import { Row } from '../../ui/Row';

// This week's goals with their progress; At risk leads the meta when the open tasks need more than the free work minutes left.
export function GoalsBlock({ items, meetings, filter, now }: { items: ItemRow[]; meetings: Meeting[]; filter: Filter; now: number }) {
  const goals = goalsOf(items, now, filter === 'all' ? undefined : filter);
  if (!goals.length) return null;
  const busy = timedMeetings(live(meetings).filter((m) => filter === 'all' || m.profile === filter)).map((m) => [m.starts_at!, m.ends_at!] as Span);
  const free = weekFreeMinutes(busy, now);
  // One goal shows itself; several fold into one row that opens the week's goals.
  if (goals.length > 1) {
    const meta = goalsLine(goals.map((g) => ({ ...goalProgress(items, g), risk: goalAtRisk(items, g, free) })));
    return <div className="ui-group"><Row title="Goals this week" meta={meta} onClick={openWeekGoals} trailing={<Icon name="chevron-right" small />} /></div>;
  }
  const g = goals[0];
  const { done, total } = goalProgress(items, g);
  const meta = [goalAtRisk(items, g, free) && 'At risk', total ? `${done}/${total} done` : 'No tasks yet', total > 0 && (done === total ? 'All done' : `Next: ${goalNext(items, g)}`)].filter(Boolean).join(' · ');
  return <div className="ui-group"><Row title={g.title} meta={meta} onClick={openWeekGoals} trailing={<Icon name="chevron-right" small />} /></div>;
}
