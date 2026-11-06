import { useMemo, useRef, useState } from 'react';
import { useAssistantStore, useAssistantTable, useSyncGate } from './data';
import { GOAL, MAX_GOALS, goalHistory, goalProgress, goalVerdict, linkedTo, reopenBlock } from './data/goals';
import { weekStart } from './data/dates';
import type { ItemRow } from './data/sync';
import { attempt, leaveGoals, openTask, openWeek, previousList, showSnack, useEscapeBack, useView } from './view';
import { useMinute } from './split';
import { LISTS } from './nav';
import { Button, IconButton } from '../ui/Button';
import { Menu, MenuItem } from '../ui/Menu';
import { EmptyState } from '../ui/Panel';
import { Row } from '../ui/Row';
import { Section } from '../ui/Section';
import { Skeleton } from '../ui/Skeleton';
import { plural } from '../ui/util';

const BLOCK_TEXT = { full: `This week is full (${MAX_GOALS} goals)`, same: 'Already this week' };

function GoalRow({ goal, items, past, showProfile, now, reopen }: { goal: ItemRow; items: ItemRow[]; past: boolean; showProfile: boolean; now: number; reopen: (g: ItemRow) => void }) {
  const [menu, setMenu] = useState(false);
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const p = goalProgress(items, goal);
  const tasks = linkedTo(items, goal).filter((r) => r.status === 'open');
  const badge = goalVerdict(p) === 'Done' ? 'Done' : past ? 'Missed' : '';
  const block = past ? reopenBlock(items, goal, now) : null;
  const meta = [p.total ? `${p.done}/${plural(p.total, 'task')}` : 'No tasks', showProfile && (goal.profile === 'work' ? 'Work' : 'Personal')].filter(Boolean).join(' · ');
  return (
    <div className="gl-hist">
      <div className="gl-hist-row">
        <Row className="inert" disabled title={goal.title} meta={meta} trailing={badge && <span className="badge quiet">{badge}</span>} />
        {(past || tasks.length > 0) && <IconButton ref={btn} icon="kebab-vertical" label="More" size="sm" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />}
        {menu && (
          <Menu trigger={btn} onClose={() => setMenu(false)}>
            {past && <MenuItem disabled={!!block} onClick={() => { setMenu(false); reopen(goal); }}>{block ? BLOCK_TEXT[block] : 'Reopen this week'}</MenuItem>}
            {tasks.length > 0 && <MenuItem onClick={() => { setMenu(false); setOpen(!open); }}>{open ? 'Hide tasks' : 'Open tasks'}</MenuItem>}
          </Menu>
        )}
      </div>
      {p.total > 0 && <span className="gl-bar" aria-hidden="true"><span style={{ width: `${(p.done / p.total) * 100}%` }} /></span>}
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
  useEscapeBack(leaveGoals);
  const reopen = async (g: ItemRow) => {
    if (busy.current) return;
    busy.current = true;
    if (await attempt(() => store.capture(g.title ?? '', GOAL, g.profile, weekStart(now)), 'Goal not reopened')) showSnack('Goal reopened');
    busy.current = false;
  };
  return (
    <div className="wk narrow">
      <header className="wk-head">
        <IconButton icon="arrow-left" label="Back" onClick={leaveGoals} />
        <div className="as-title-wrap">
          <button className="as-crumb" onClick={leaveGoals}>{LISTS.find((l) => l.id === previousList())?.label}</button>
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
                {w.goals.map((g) => <GoalRow key={g.profile + g.id} goal={g} items={items} past={w.start < weekStart(now)} showProfile={filter === 'all'} now={now} reopen={reopen} />)}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
