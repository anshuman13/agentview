import { useState } from 'react';
import { blockId, isBlock } from '../../../shared/util';
import { rowKey, type ItemRow } from './data/sync';
import type { Meeting } from './data/wiki';
import { useAssistantTable, useAssistantStore } from './data';
import { goalsOf } from './data/goals';
import { atTime } from './data/engine';
import { defaultBlock, estimateMin, fitBlock, focusTitle, minutesText, packDay, timedMeetings, workGaps, type Span } from './data/plan';
import { clock } from './time';
import { attempt, showSnack, useView } from './view';
import { PlanPreview, usePlanFlow } from './PlanPreview';
import type { Planned } from './planFlow';
import { Icon } from '../ui/Icon';
import { Chip } from '../ui/Button';

const hhmm = (n: number) => minutesText(Math.round(n / 60_000));
export const DRAG_TYPE = 'application/x-codex-item';

type Pick = { end: number; key: string; start: string; minutes: number; title: string };

const atClock = (day: number, text: string) => {
  const [h, m] = text.split(':').map(Number);
  const d = new Date(day);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
};

const toMinute = (t: number) => Math.floor(t / 60_000) * 60_000;

// The free span that holds the gap ending at end, its start cut to the minute so the start field can name it.
function slotGap(busy: Span[], now: number, end: number): Span | null {
  const g = workGaps(busy, now).find(([a, b]) => a < end && end <= b);
  return g ? [toMinute(g[0]), g[1]] : null;
}

function pickFor(gap: Span, r: ItemRow | undefined): Pick {
  const [a, b] = (r && defaultBlock(gap, r.title)) || defaultBlock(gap, null) || gap;
  return { end: gap[1], key: r ? rowKey(r) : '', start: clock(a), minutes: Math.round((b - a) / 60_000), title: r ? focusTitle(r.title) : '' };
}

// Today's free gaps in work hours from now, and planned estimates against the free time. A gap opens a form to block time for a task;
// Plan my day previews blocks for all overdue and due tasks and creates them on Create.
export function DayPlan({ meetings, open, late = [], now }: { meetings: Meeting[]; open: ItemRow[]; late?: ItemRow[]; now: number }) {
  const store = useAssistantStore();
  const [pick, setPick] = useState<Pick | null>(null);
  const [saving, setSaving] = useState(false);
  const items = useAssistantTable('items');
  const { filter } = useView();
  const goals = new Set(goalsOf(items, now, filter === 'all' ? undefined : filter).map(rowKey));
  const forGoal = (r: ItemRow) => !!r.goal && goals.has(`${r.profile}:${r.goal}`);
  const listed = new Set([...late, ...open].map(rowKey));
  const goalTasks = items.filter((r) => !r.deleted && r.status === 'open' && r.source !== 'calendar' && forGoal(r) && !listed.has(rowKey(r)));
  const timed = timedMeetings(meetings);
  const busy = timed.map((m) => [m.starts_at!, m.ends_at!] as Span);
  const blocks = timed.filter((m) => isBlock(m.id) && m.ends_at! > now);
  const gaps = workGaps(busy, now);
  // Packs the open tasks without a block, or only those in keep, into the free time left from this moment; tasks for this week's
  // goals, due or not, go first.
  const pack = (keep?: Set<string>): Planned[] => {
    const blocked = new Set(blocks.map((m) => `${m.profile}:${m.id}`));
    const tasks = [...late, ...open, ...goalTasks].filter((r) => !blocked.has(`${r.profile}:${blockId(r.id)}`) && (!keep || keep.has(rowKey(r)))).map((r) => ({ title: r.title, due: atTime(r.at), goal: forGoal(r), r }));
    return packDay(tasks, workGaps(busy, Date.now())).map((p) => ({ task: p.task.r, span: p.span }));
  };
  const flow = usePlanFlow(pack);
  const { plan } = flow;
  const planned = open.reduce((n, r) => n + (estimateMin(r.title) ?? 0), 0);
  if (!gaps.length && !planned && !blocks.length) return null;
  const free = gaps.reduce((n, [a, b]) => n + b - a, 0);
  const task = pick && open.find((r) => rowKey(r) === pick.key);
  const gap = pick ? gaps.find((g) => g[1] === pick.end) ?? null : null;
  const own = task && timed.find((m) => m.profile === task.profile && m.id === blockId(task.id));
  const slot = pick && slotGap(own ? busy.filter((_, i) => timed[i] !== own) : busy, now, pick.end);
  const span = slot && pick.start ? fitBlock(slot, atClock(now, pick.start), pick.minutes) : null;
  const choose = (gap: Span, r?: ItemRow) => setPick(pickFor(gap, r ?? (open.length === 1 ? open[0] : undefined)));
  const drop = (gap: Span) => (e: React.DragEvent) => {
    const r = open.find((x) => rowKey(x) === e.dataTransfer.getData(DRAG_TYPE));
    if (!r) return;
    e.preventDefault();
    choose(gap, r);
  };
  const planDay = () => {
    setPick(null);
    flow.start();
  };
  const create = async () => {
    if (!task || !span || !pick?.title.trim()) return;
    setSaving(true);
    if (await attempt(() => store.blockTime(task, span[0], span[1], pick.title.trim()), 'Not blocked')) {
      showSnack(`Blocked ${clock(span[0])}-${clock(span[1])} for ${task.title}`);
      setPick(null);
    }
    setSaving(false);
  };
  const chips = [
    ...gaps.map((g) => ({ at: g[0], el: (
      <Chip key={`g${g[0]}`} on={pick?.end === g[1]} title="Block time for a task" onClick={() => { flow.setPlan(null); if (pick?.end === g[1]) setPick(null); else choose(g); }} onDragOver={(e) => e.dataTransfer.types.includes(DRAG_TYPE) && e.preventDefault()} onDrop={drop(g)}>
        {clock(g[0])}-{clock(g[1])}
      </Chip>
    ) })),
    ...blocks.map((m) => ({ at: m.starts_at!, el: <span key={m.profile + m.id} className="chip" title={m.title ?? ''}>{clock(m.starts_at!)}-{clock(m.ends_at!)} {m.title}</span> })),
  ].sort((a, b) => a.at - b.at);
  if (!plan && !pick && !timed.some((m) => isBlock(m.id))) {
    return gaps.length > 0 && (late.length || open.length || goalTasks.length) ? <div className="as-next-actions"><button className="btn sm" onClick={planDay}><Icon name="sparkle" small /> Plan my day</button></div> : null;
  }
  return (
    <section>
      <div className="as-section">Plan · {planned ? `planned ${minutesText(planned)} / ` : ''}free {hhmm(free)}</div>
      <div className="as-chips">
        {chips.map((c) => c.el)}
        {!gaps.length && <span className="as-ctx">No free time left in work hours</span>}
        {gaps.length > 0 && (late.length > 0 || open.length > 0 || goalTasks.length > 0) && <Chip on={!!plan} onClick={() => (plan ? flow.setPlan(null) : planDay())}>Plan my day</Chip>}
      </div>
      <PlanPreview flow={flow} day="today" />
      {pick && (
        <div className="ov-card dp-block">
          {open.length ? (
            <>
              <select value={pick.key} aria-label="Task" onChange={(e) => setPick({ ...pickFor(gap ?? [now, pick.end], open.find((r) => rowKey(r) === e.target.value)), key: e.target.value })}>
                <option value="" disabled>Pick a task due today</option>
                {open.map((r) => <option key={rowKey(r)} value={rowKey(r)}>{r.title}</option>)}
              </select>
              <input value={pick.title} aria-label="Event title" placeholder="Event title" onChange={(e) => setPick({ ...pick, title: e.target.value })} />
              <div className="dp-when">
                <input type="time" value={pick.start} aria-label="Start" min={slot ? clock(slot[0]) : undefined} max={slot ? clock(slot[1]) : undefined} onChange={(e) => setPick({ ...pick, start: e.target.value })} />
                <input type="number" value={pick.minutes} aria-label="Minutes" min={5} step={5} onChange={(e) => setPick({ ...pick, minutes: Number(e.target.value) })} />
                <span className="muted small">{span ? `min, ends ${clock(span[1])}` : 'min, outside this gap'}</span>
              </div>
              <div className="dp-when">
                <span className="muted small">{task ? `Creates a calendar event on the ${task.profile} calendar, no attendees` : ''}</span>
                <span className="spacer" />
                <button className="btn sm" onClick={() => setPick(null)}>Cancel</button>
                <button className="btn sm primary" disabled={saving || !task || !span || !pick.title.trim()} onClick={() => void create()}>{saving ? 'Creating' : 'Create'}</button>
              </div>
            </>
          ) : (
            <span className="as-ctx">No tasks due today to block time for</span>
          )}
        </div>
      )}
    </section>
  );
}
