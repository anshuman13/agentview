import { useRef, useState } from 'react';
import { useAssistantData, useAssistantStore } from './data';
import { GOAL, MAX_GOALS, carryOver, goalProgress, goalsOf, linkedTo } from './data/goals';
import { weekStart } from './data/dates';
import type { ItemRow, Profile } from './data/sync';
import { openTask, showSnack, useView } from './view';
import { Icon } from '../ui/Icon';
import { save, stored } from '../ui/util';

function GoalInput({ row }: { row: ItemRow }) {
  const store = useAssistantStore();
  const [text, setText] = useState(row.title ?? '');
  const save = () => {
    const t = text.trim();
    if (t && t !== row.title) void store.update(row, { title: t.slice(0, 120) });
  };
  return (
    <div className="gl-row" role="listitem">
      <input className="gl-input" value={text} aria-label="Goal" onChange={(e) => setText(e.target.value)} onBlur={save}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') setText(row.title ?? ''); }} />
      <button className="icon-btn" title="Remove goal" aria-label={`Remove ${row.title}`} onClick={() => { void store.update(row, { deleted: 1 }); showSnack('Goal removed', () => void store.update(row, { deleted: 0 })); }}><Icon name="close" small /></button>
    </div>
  );
}

// Up to three goals for the current week, on the Week view.
export function WeekGoals({ now }: { now: number }) {
  const store = useAssistantStore();
  const { items } = useAssistantData();
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
    try {
      await store.capture(t, GOAL, profile, weekStart(now));
    } finally {
      adding.current = false;
    }
  };
  return (
    <section className="mt-wk-sec">
      <div className="mt-load-head">Goals this week ({goals.length}/{MAX_GOALS})</div>
      {goals.length > 0 && <div role="list" aria-label="Goals">{goals.map((g) => <GoalInput key={g.profile + g.id} row={g} />)}</div>}
      {filter === 'all' && (
        <select className="as-chip quiet" value={pick} aria-label="Goal profile" onChange={(e) => setPick(e.target.value as Profile)}>
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

// One slim line per goal of this week with done of total linked tasks; a line expands to its open tasks.
function GoalLine({ goal, items }: { goal: ItemRow; items: ItemRow[] }) {
  const [open, setOpen] = useState(false);
  const p = goalProgress(items, goal);
  const tasks = linkedTo(items, goal).filter((r) => r.status === 'open');
  return (
    <div role="listitem">
      <button className="gl-line" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} small /> <span className="muted small">This week</span> <span className="ov-t">{goal.title}</span> <span className="muted small">{p.done}/{p.total}<span className="sr-only"> tasks done</span></span>
      </button>
      {open && (tasks.length
        ? <ul className="gl-tasks">{tasks.map((t) => <li key={t.id}><button className="ov-follow-text" onClick={() => openTask(t)}>{t.title}</button></li>)}</ul>
        : <div className="muted small gl-tasks">No open tasks</div>)}
    </div>
  );
}

const CARRY_SKIPPED = 'codex.goalCarrySkipped';

export function GoalLines({ now }: { now: number }) {
  const store = useAssistantStore();
  const { items } = useAssistantData();
  const { filter } = useView();
  const scope = filter === 'all' ? undefined : filter;
  const goals = goalsOf(items, now, scope);
  const carry = carryOver(items, now, scope);
  const busy = useRef(false);
  const week = String(weekStart(now));
  const [skipped, setSkipped] = useState(() => stored<string>(CARRY_SKIPPED, '') === week);
  const skip = () => { save(CARRY_SKIPPED, week); setSkipped(true); };
  const carryAll = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      for (const g of carry) await store.capture(g.title ?? '', GOAL, g.profile, weekStart(now));
    } finally {
      busy.current = false;
    }
  };
  if (!goals.length && (!carry.length || skipped)) return null;
  return (
    <section className="gl-lines" role="list" aria-label="Goals this week">
      {goals.map((g) => <GoalLine key={g.profile + g.id} goal={g} items={items} />)}
      {!goals.length && (
        <div className="gl-line" role="listitem">
          <span className="muted small">Carry over {carry.length} {carry.length === 1 ? 'goal' : 'goals'} from last week</span>
          <button className="as-chip" onClick={() => void carryAll()}>Carry over</button>
          <button className="as-chip quiet" onClick={skip}>Not now</button>
        </div>
      )}
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
