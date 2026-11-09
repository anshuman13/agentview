import { useEffect, useRef, useState } from 'react';
import { useAssistantTable, useAssistantStore } from '../data';
import { GOAL, MAX_GOALS, goalsOf } from '../data/tasks/goals';
import { weekStart } from '../data/dates';
import type { ItemRow, Profile } from '../data/sync';
import { attempt, openWeekGoals, showSnack, useView } from '../view';
import { Icon } from '../../ui/Icon';
import { Section } from '../../ui/Section';
import { Button, chipClass } from '../../ui/Button';

function GoalInput({ row }: { row: ItemRow }) {
  const store = useAssistantStore();
  const [text, setText] = useState(row.title ?? '');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (document.activeElement !== input.current) setText(row.title ?? ''); }, [row.title]);
  const save = () => {
    const t = text.trim();
    if (t && t !== row.title) void store.update(row, { title: t.slice(0, 120) });
  };
  return (
    <div className="gl-row" role="listitem">
      <input ref={input} className="gl-input" value={text} aria-label="Goal" onChange={(e) => setText(e.target.value)} onBlur={() => { if (text.trim()) save(); else setText(row.title ?? ''); }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') setText(row.title ?? ''); }} />
      <button className="icon-btn" title="Remove goal" aria-label={`Remove ${row.title}`} onClick={() => { void store.update(row, { deleted: 1 }); showSnack('Goal removed', () => void store.update(row, { deleted: 0 })); }}><Icon name="close" small /></button>
    </div>
  );
}

// Up to three goals for the current week, on the Week view.
export function WeekGoals({ now }: { now: number }) {
  const store = useAssistantStore();
  const items = useAssistantTable('items');
  const { filter } = useView();
  const [pick, setPick] = useState<Profile>('work');
  const profile = filter === 'all' ? pick : filter;
  const goals = goalsOf(items, now, profile);
  const [text, setText] = useState('');
  const adding = useRef(false);
  const add = async () => {
    const t = text.trim();
    if (!t || adding.current || goals.length >= MAX_GOALS) return;
    adding.current = true;
    setText('');
    if (!(await attempt(() => store.capture(t, GOAL, profile, weekStart(now)), 'Goal not saved'))) setText(t);
    adding.current = false;
  };
  return (
    <section className="mt-wk-sec">
      <Section label="Goals this week" count={goals.length} action={<Button size="sm" variant="plain" onClick={openWeekGoals}>All goals</Button>} />
      {goals.length > 0 && <div role="list" aria-label="Goals">{goals.map((g) => <GoalInput key={g.profile + g.id} row={g} />)}</div>}
      {filter === 'all' && (
        <select className={chipClass({ quiet: true })} value={pick} aria-label="Goal profile" onChange={(e) => setPick(e.target.value as Profile)}>
          <option value="work">Work</option>
          <option value="personal">Personal</option>
        </select>
      )}
      {goals.length < MAX_GOALS && (
        <input className="gl-input" value={text} placeholder="Add a goal" aria-label="New goal" enterKeyHint="done" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void add(); else if (e.key === 'Escape') setText(''); }} />
      )}
    </section>
  );
}

// Links a task to one of this week's goals of its profile.
export function GoalPick({ row, onPick }: { row: ItemRow; onPick: (goal: string | null) => void }) {
  const items = useAssistantTable('items');
  const goals = goalsOf(items, Date.now(), row.profile);
  const linked = row.goal ? items.find((r) => r.profile === row.profile && r.id === row.goal && !r.deleted) : undefined;
  if (!goals.length && !linked) return null;
  const options = linked && !goals.includes(linked) ? [linked, ...goals] : goals;
  return (
    <select className={chipClass({ quiet: !linked })} value={linked?.id ?? ''} aria-label="Goal" onChange={(e) => onPick(e.target.value || null)}>
      <option value="">No goal</option>
      {options.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
    </select>
  );
}
