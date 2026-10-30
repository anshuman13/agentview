import { useState } from 'react';
import { useAssistantData, useAssistantStore } from './data';
import { GOAL, MAX_GOALS, goalProgress, goalsOf, weekStart } from './data/goals';
import type { ItemRow } from './data/sync';
import { showSnack, useView } from './view';
import { Icon } from '../ui/Icon';

function GoalInput({ row }: { row: ItemRow }) {
  const store = useAssistantStore();
  const [text, setText] = useState(row.title ?? '');
  const save = () => {
    const t = text.trim();
    if (t && t !== row.title) void store.update(row, { title: t.slice(0, 120) });
  };
  return (
    <div className="gl-row">
      <input className="gl-input" value={text} aria-label="Goal" onChange={(e) => setText(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
      <button className="icon-btn" title="Remove goal" aria-label={`Remove ${row.title}`} onClick={() => { void store.update(row, { deleted: 1 }); showSnack('Goal removed', () => void store.update(row, { deleted: 0 })); }}><Icon name="close" small /></button>
    </div>
  );
}

// Up to three goals for the current week, on the Week view.
export function WeekGoals({ now }: { now: number }) {
  const store = useAssistantStore();
  const { items } = useAssistantData();
  const { filter } = useView();
  const profile = filter === 'all' ? 'work' : filter;
  const goals = goalsOf(items, now, profile);
  const [text, setText] = useState('');
  const add = async () => {
    const t = text.trim();
    if (!t || goals.length >= MAX_GOALS) return;
    setText('');
    await store.capture(t, GOAL, profile, weekStart(now));
  };
  return (
    <section className="mt-wk-sec">
      <div className="mt-load-head">Goals this week ({goals.length}/{MAX_GOALS})</div>
      {goals.map((g) => <GoalInput key={g.profile + g.id} row={g} />)}
      {goals.length < MAX_GOALS && (
        <input className="gl-input" value={text} placeholder="Add a goal" aria-label="New goal" enterKeyHint="done" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} />
      )}
    </section>
  );
}

// One slim line per goal of this week with done of total linked tasks.
export function GoalLines({ now }: { now: number }) {
  const { items } = useAssistantData();
  const { filter } = useView();
  const goals = goalsOf(items, now, filter === 'all' ? undefined : filter);
  if (!goals.length) return null;
  return (
    <section className="gl-lines">
      {goals.map((g) => {
        const p = goalProgress(items, g);
        return <div key={g.profile + g.id} className="gl-line"><span className="muted small">This week</span> <span className="ov-t">{g.title}</span> <span className="muted small">{p.done}/{p.total}</span></div>;
      })}
    </section>
  );
}

// Links a task to one of this week's goals of its profile.
export function GoalPick({ row, onPick }: { row: ItemRow; onPick: (goal: string | null) => void }) {
  const { items } = useAssistantData();
  const goals = goalsOf(items, Date.now(), row.profile);
  const linked = row.goal ? items.find((r) => r.profile === row.profile && r.id === row.goal && !r.deleted) : undefined;
  if (!goals.length && !linked) return null;
  const options = linked && !goals.includes(linked) ? [linked, ...goals] : goals;
  return (
    <select className={`as-chip${linked ? '' : ' quiet'}`} value={linked?.id ?? ''} aria-label="Goal" onChange={(e) => onPick(e.target.value || null)}>
      <option value="">No goal</option>
      {options.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
    </select>
  );
}
