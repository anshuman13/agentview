import { useEffect, useMemo, useRef, useState } from 'react';
import { useAssistantTable, useAssistantStore, useAssistantData } from './data';
import { GOAL, MAX_GOALS, carryOver, goalAtRisk, goalProgress, goalsOf } from './data/goals';
import { weekStart } from './data/dates';
import { weekFreeMinutes, type Span } from './data/plan';
import { live } from './data/wiki';
import type { ItemRow, Profile } from './data/sync';
import { attempt, openWeekGoals, showSnack, useView } from './view';
import { Icon } from '../ui/Icon';
import { Button, Chip, chipClass } from '../ui/Button';
import { plural, save, stored } from '../ui/util';

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
      <div className="gl-head">
        <div className="mt-load-head">Goals this week ({goals.length}/{MAX_GOALS})</div>
        <Button size="sm" variant="plain" onClick={openWeekGoals}>All goals</Button>
      </div>
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

// Free work minutes left this week per profile, from its meetings.
export function useWeekFree(now: number) {
  const { meetings } = useAssistantData();
  const minute = Math.floor(now / 60000);
  return useMemo(() => {
    const out: Partial<Record<Profile, number>> = {};
    for (const p of ['work', 'personal'] as const) {
      const spans = live(meetings).filter((m) => m.profile === p && m.starts_at != null && m.ends_at != null && m.ends_at > m.starts_at && m.ends_at - m.starts_at < 20 * 3600_000).map((m) => [m.starts_at!, m.ends_at!] as Span);
      out[p] = weekFreeMinutes(spans, minute * 60000);
    }
    return out;
  }, [meetings, minute]);
}

export const goalsMeta = (count: number, risk: number) => [plural(count, 'goal'), risk ? `${risk} at risk` : ''].filter(Boolean).join(' · ');

// This week's unfinished goals, as the Goals row on Overview counts them, and how many are at risk.
export function useGoalsCount(now: number) {
  const items = useAssistantTable('items');
  const { filter } = useView();
  const free = useWeekFree(now);
  const goals = goalsOf(items, now, filter === 'all' ? undefined : filter).filter((g) => { const p = goalProgress(items, g); return !p.total || p.done < p.total; });
  return { count: goals.length, risk: goals.filter((g) => goalAtRisk(items, g, free[g.profile] ?? 0)).length };
}

const CARRY_SKIPPED = 'codex.goalCarrySkipped';

export function GoalLines({ now }: { now: number }) {
  const store = useAssistantStore();
  const items = useAssistantTable('items');
  const { filter } = useView();
  const scope = filter === 'all' ? undefined : filter;
  const carry = carryOver(items, now, scope);
  const busy = useRef(false);
  const week = String(weekStart(now));
  const [skipped, setSkipped] = useState(() => stored<string>(CARRY_SKIPPED, '') === week);
  const skip = () => { save(CARRY_SKIPPED, week); setSkipped(true); };
  const carryAll = async () => {
    if (busy.current) return;
    busy.current = true;
    await attempt(async () => { for (const g of carry) await store.capture(g.title ?? '', GOAL, g.profile, weekStart(now)); }, 'Not carried over');
    busy.current = false;
  };
  if (!carry.length || skipped) return null;
  return (
    <section className="gl-lines" role="list" aria-label="Goals this week">
      <div className="gl-line" role="listitem">
        <span className="muted small">Carry over {carry.length} {carry.length === 1 ? 'goal' : 'goals'} from last week</span>
        <Chip onClick={() => void carryAll()}>Carry over</Chip>
        <Chip quiet onClick={skip}>Not now</Chip>
      </div>
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
