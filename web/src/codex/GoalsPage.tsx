import { useMemo, useRef, useState } from 'react';
import { useAssistantStore, useAssistantTable, useSyncGate } from './data';
import { GOAL, MAX_GOALS, goalHistory, goalProgress, goalsOf, goalVerdict, linkedTo, moveBlock, reopenBlock, titleKey } from './data/goals';
import { weekStart } from './data/dates';
import { atTime } from './data/engine';
import type { ItemRow } from './data/sync';
import { attempt, leaveOverlay, openTask, openWeek, previousList, showSnack, useEscapeBack, useView } from './view';
import { useMinute } from './split';
import { LISTS } from './nav';
import { Button, IconButton } from '../ui/Button';
import { Menu, MenuItem, MenuSeparator } from '../ui/Menu';
import { EmptyState } from '../ui/Panel';
import { Row } from '../ui/Row';
import { Section } from '../ui/Section';
import { Skeleton } from '../ui/Skeleton';

const BLOCK_TEXT = { full: `This week is full (${MAX_GOALS} goals)`, same: 'Already this week' };
const MOVE_TEXT = { full: `Next week is full (${MAX_GOALS} goals)`, same: 'Already a goal next week with this title' };

type Actions = { reopen: (g: ItemRow) => void; move: (g: ItemRow) => void; rename: (g: ItemRow, title: string) => Promise<void>; remove: (g: ItemRow) => void };

function GoalRow({ goal, items, showProfile, now, reopen, move, rename, remove }: { goal: ItemRow; items: ItemRow[]; showProfile: boolean; now: number } & Actions) {
  const [menu, setMenu] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  const p = goalProgress(items, goal);
  const tasks = linkedTo(items, goal).filter((r) => r.status === 'open');
  const start = weekStart(atTime(goal.at) ?? now);
  const thisWeek = weekStart(now);
  const past = start < thisWeek;
  const block = past ? reopenBlock(items, goal, now) : start === thisWeek ? moveBlock(items, goal, now) : null;
  const week = `Week of ${new Date(start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
  const meta = [p.total ? `${p.total - p.done} open · ${p.done} done` : 'No tasks', week, showProfile && (goal.profile === 'work' ? 'Work' : 'Personal')].filter(Boolean).join(' · ');
  const finish = (save: boolean) => {
    if (cancelled.current) return;
    cancelled.current = true;
    setEditing(false);
    const title = input.current?.value.trim().slice(0, 120) ?? '';
    if (save && title && title !== goal.title) void rename(goal, title);
  };
  const edit = (
    <input ref={input} className="gl-input" defaultValue={goal.title ?? ''} maxLength={120} aria-label="Goal" autoFocus onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish(true)} onKeyDown={(e) => { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') { e.stopPropagation(); finish(false); } }} />
  );
  return (
    <div className="gl-hist">
      <div className="gl-hist-row">
        {editing
          ? <Row plain title={edit} meta={meta} />
          : <Row className="inert" disabled title={goal.title} meta={meta} trailing={goalVerdict(p) === 'Done' && <span className="badge quiet">Done</span>} />}
        <IconButton ref={btn} icon="kebab-vertical" label="More" size="sm" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
        {menu && (
          <Menu trigger={btn} onClose={() => setMenu(false)}>
            <MenuItem onClick={() => { setMenu(false); cancelled.current = false; setEditing(true); }}>Rename</MenuItem>
            {start === thisWeek && <MenuItem disabled={!!block} onClick={() => { setMenu(false); move(goal); }}>{block ? MOVE_TEXT[block] : 'Move to next week'}</MenuItem>}
            {past && <MenuItem disabled={!!block} onClick={() => { setMenu(false); reopen(goal); }}>{block ? BLOCK_TEXT[block] : 'Reopen this week'}</MenuItem>}
            {tasks.length > 0 && <MenuItem onClick={() => { setMenu(false); setOpen(!open); }}>{open ? 'Hide tasks' : 'Open tasks'}</MenuItem>}
            <MenuSeparator />
            <MenuItem danger onClick={() => { setMenu(false); remove(goal); }}>Delete</MenuItem>
          </Menu>
        )}
      </div>
      {open && <ul className="gl-tasks">{tasks.map((t) => <li key={t.id}><button className="ov-follow-text" onClick={() => openTask(t)}>{t.title}</button></li>)}</ul>}
    </div>
  );
}

export function GoalsPage() {
  const store = useAssistantStore();
  const items = useAssistantTable('items');
  const gate = useSyncGate();
  const { filter } = useView();
  const now = useMinute();
  const weeks = useMemo(() => goalHistory(items, now, filter === 'all' ? undefined : filter), [items, now, filter]);
  const busy = useRef(false);
  useEscapeBack(leaveOverlay);
  const reopen = async (g: ItemRow) => {
    if (busy.current) return;
    busy.current = true;
    if (await attempt(() => store.capture(g.title ?? '', GOAL, g.profile, weekStart(now)), 'Goal not reopened')) showSnack('Goal reopened');
    busy.current = false;
  };
  const move = async (g: ItemRow) => {
    if (busy.current) return;
    busy.current = true;
    const d = new Date(weekStart(now));
    const at = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime();
    if (await attempt(() => store.update(g, { at }), 'Goal not moved')) showSnack('Moved to next week', () => void store.update(g, { at: g.at as number }));
    busy.current = false;
  };
  const rename = async (g: ItemRow, title: string) => {
    if (goalsOf(items, atTime(g.at) ?? now, g.profile).some((r) => r.id !== g.id && titleKey(r.title) === titleKey(title))) return showSnack('Already a goal that week');
    await attempt(() => store.update(g, { title }), 'Goal not renamed');
  };
  const remove = (g: ItemRow) => {
    void store.update(g, { deleted: 1 });
    showSnack('Goal deleted', () => void store.update(g, { deleted: 0 }));
  };
  return (
    <div className="wk narrow">
      <header className="wk-head">
        <IconButton icon="arrow-left" label="Back" onClick={leaveOverlay} />
        <div className="as-title-wrap">
          <button className="as-crumb" onClick={leaveOverlay}>{LISTS.find((l) => l.id === previousList())?.label}</button>
          <h1>{LISTS.find((l) => l.id === 'goals')!.label}</h1>
        </div>
      </header>
      <div className="wk-scroll">
        <div className="mt-list">
          {gate.loading && !items.length ? <Skeleton /> : !weeks.length ? (
            <EmptyState size="sm" icon="target" title="No goals yet" hint="Set goals in Meetings > Week" action={<Button size="sm" onClick={openWeek}>Open Week</Button>} />
          ) : weeks.map((w) => (
            <section key={w.start}>
              <Section label={w.label} />
              <div className="ov-group">
                {w.goals.map((g) => <GoalRow key={g.profile + g.id} goal={g} items={items} showProfile={filter === 'all'} now={now} reopen={reopen} move={move} rename={rename} remove={remove} />)}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
