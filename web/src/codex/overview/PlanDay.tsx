import { useState } from 'react';
import type { Meeting } from '../data/wiki/wiki';
import { atTime } from '../data/tasks/engine';
import { estimateMin, planToday, timedMeetings, type Span } from '../data/tasks/plan';
import type { ItemRow } from '../data/sync';
import { Button } from '../../ui/Button';
import { Row } from '../../ui/Row';
import { Section } from '../../ui/Section';
import { plural } from '../../ui/util';
import { showSnack } from '../view';
import { useActions } from '../useActions';
import { clock, hasTime } from '../tasks/time';

type Slot = { task: ItemRow; span: Span };

// Proposes slots for today's estimated tasks in the free work gaps; Accept sets each task's due time, with one undo.
export function PlanDay({ meetings, tasks, now }: { meetings: Meeting[]; tasks: ItemRow[]; now: number }) {
  const act = useActions();
  const [plan, setPlan] = useState<Slot[] | null>(null);
  const accept = (slots: Slot[]) => {
    for (const { task, span } of slots) act.edit(task, { at: span[0] });
    const left = plan?.filter((x) => !slots.includes(x));
    setPlan(left?.length ? left : null);
    showSnack(`Planned ${plural(slots.length, 'task')}`, () => slots.forEach(({ task }) => act.edit(task, { at: task.at })));
  };
  const propose = () => {
    const busy = timedMeetings(meetings).map((m) => [m.starts_at!, m.ends_at!] as Span);
    const slots = planToday(tasks.map((task) => ({ task, title: task.title, due: atTime(task.at), timed: hasTime(atTime(task.at)) })), busy, now).map((p) => ({ task: p.task.task, span: p.span }));
    if (slots.length) setPlan(slots);
    else showSnack('No estimated task fits the free time today');
  };
  // The offer shows in the morning only; later the day is already planned or gone.
  if (!plan) return new Date(now).getHours() < 12 && tasks.some((r) => !hasTime(atTime(r.at)) && estimateMin(r.title) != null) ? <Button variant="quiet" size="sm" onClick={propose}>Plan my day</Button> : null;
  return (
    <section>
      <Section label="Plan my day" action={<Button variant="quiet" size="sm" onClick={() => setPlan(null)}>Close</Button>} />
      <div className="as-group">
        {[...plan].sort((a, b) => a.span[0] - b.span[0]).map((x) => (
          <Row key={x.task.profile + x.task.id} plain title={x.task.title} meta={`${clock(x.span[0])} - ${clock(x.span[1])}`}
            trailing={<Button variant="quiet" size="sm" onClick={() => accept([x])}>Accept</Button>} />
        ))}
      </div>
      <Button variant="primary" size="sm" onClick={() => accept(plan)}>Accept all</Button>
    </section>
  );
}
