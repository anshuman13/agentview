import { goalAtRisk, goalProgress, goalsOf } from '../data/tasks/goals';
import { timedMeetings, weekFreeMinutes, type Span } from '../data/tasks/plan';
import type { ItemRow } from '../data/sync';
import { live, type Meeting } from '../data/wiki/wiki';
import { openWeekGoals, type Filter } from '../view';
import { Icon } from '../../ui/Icon';
import { Row } from '../../ui/Row';
import { Section, sectionCount } from '../../ui/Section';

// This week's goals with their progress; At risk leads the meta when the open tasks need more than the free work minutes left.
export function GoalsBlock({ items, meetings, filter, now }: { items: ItemRow[]; meetings: Meeting[]; filter: Filter; now: number }) {
  const goals = goalsOf(items, now, filter === 'all' ? undefined : filter);
  if (!goals.length) return null;
  const busy = timedMeetings(live(meetings).filter((m) => filter === 'all' || m.profile === filter)).map((m) => [m.starts_at!, m.ends_at!] as Span);
  const free = weekFreeMinutes(busy, now);
  return (
    <section>
      <Section label="Goals this week" count={sectionCount(goals.length)} />
      <div className="ui-group">
        {goals.map((g) => {
          const { done, total } = goalProgress(items, g);
          const meta = [goalAtRisk(items, g, free) && 'At risk', filter === 'all' && (g.profile === 'work' ? 'Work' : 'Personal'), total ? `${done}/${total} done` : 'No tasks yet'].filter(Boolean).join(' · ');
          return <Row key={g.profile + g.id} title={g.title} meta={meta} onClick={openWeekGoals} trailing={<Icon name="chevron-right" small />} />;
        })}
      </div>
    </section>
  );
}
