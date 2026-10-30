import { useState } from 'react';
import type { ItemRow } from './data/sync';
import type { Meeting } from './data/wiki';
import { useAssistantStore } from './data';
import { errorText } from './data/engine';
import { defaultBlock, estimateMin, fitBlock, focusTitle, minutesText, workGaps, type Span } from './data/plan';
import { clock } from './time';
import { showSnack } from './view';

const hhmm = (n: number) => minutesText(Math.round(n / 60_000));
const keyOf = (r: ItemRow) => `${r.profile}:${r.id}`;
export const DRAG_TYPE = 'application/x-codex-item';

type Pick = { gap: Span; key: string; start: string; minutes: number; title: string };

const atClock = (day: number, text: string) => {
  const [h, m] = text.split(':').map(Number);
  const d = new Date(day);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
};

function pickFor(gap: Span, r: ItemRow | undefined): Pick {
  const [a, b] = (r && defaultBlock(gap, r.title)) || defaultBlock(gap, null) || gap;
  return { gap, key: r ? keyOf(r) : '', start: clock(a), minutes: Math.round((b - a) / 60_000), title: r ? focusTitle(r.title) : '' };
}

// Today's free gaps in work hours from now, and planned estimates against the free time. A gap opens a form to block time for a task.
export function DayPlan({ meetings, open, now }: { meetings: Meeting[]; open: ItemRow[]; now: number }) {
  const store = useAssistantStore();
  const [pick, setPick] = useState<Pick | null>(null);
  const [saving, setSaving] = useState(false);
  const timed = meetings.filter((m) => m.starts_at != null && m.ends_at != null && m.ends_at > m.starts_at && new Date(m.ends_at).getTime() - m.starts_at < 20 * 3600_000);
  const busy = timed.map((m) => [m.starts_at!, m.ends_at!] as Span);
  const blocks = timed.filter((m) => m.id.startsWith('block:') && m.ends_at! > now);
  const gaps = workGaps(busy, now);
  const planned = open.reduce((n, r) => n + (estimateMin(r.title) ?? 0), 0);
  if (!gaps.length && !planned && !blocks.length) return null;
  const free = gaps.reduce((n, [a, b]) => n + b - a, 0);
  const task = pick && open.find((r) => keyOf(r) === pick.key);
  const span = pick && pick.start ? fitBlock(pick.gap, atClock(pick.gap[0], pick.start), pick.minutes) : null;
  const choose = (gap: Span, r?: ItemRow) => setPick(pickFor(gap, r ?? (open.length === 1 ? open[0] : undefined)));
  const drop = (gap: Span) => (e: React.DragEvent) => {
    const r = open.find((x) => keyOf(x) === e.dataTransfer.getData(DRAG_TYPE));
    if (!r) return;
    e.preventDefault();
    choose(gap, r);
  };
  const create = async () => {
    if (!task || !span || !pick?.title.trim()) return;
    setSaving(true);
    try {
      await store.blockTime(task, span[0], span[1], pick.title.trim());
      showSnack(`Blocked ${clock(span[0])}-${clock(span[1])} for ${task.title}`);
      setPick(null);
    } catch (err) {
      showSnack(`Not blocked: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  };
  const chips = [
    ...gaps.map((g) => ({ at: g[0], el: (
      <button key={`g${g[0]}`} className={`as-chip${pick?.gap[0] === g[0] ? ' on' : ''}`} title="Block time for a task" onClick={() => (pick?.gap[0] === g[0] ? setPick(null) : choose(g))} onDragOver={(e) => e.dataTransfer.types.includes(DRAG_TYPE) && e.preventDefault()} onDrop={drop(g)}>
        {clock(g[0])}-{clock(g[1])}
      </button>
    ) })),
    ...blocks.map((m) => ({ at: m.starts_at!, el: <span key={m.profile + m.id} className="as-chip on" title={m.title ?? ''}>{clock(m.starts_at!)}-{clock(m.ends_at!)} {m.title}</span> })),
  ].sort((a, b) => a.at - b.at);
  return (
    <section>
      <div className="as-section">Plan · {planned ? `planned ${minutesText(planned)} / ` : ''}free {hhmm(free)}</div>
      <div className="as-chips">
        {chips.map((c) => c.el)}
        {!gaps.length && <span className="as-ctx">No free time left in work hours</span>}
      </div>
      {pick && (
        <div className="ov-card dp-block">
          {open.length ? (
            <>
              <select value={pick.key} aria-label="Task" onChange={(e) => setPick({ ...pickFor(pick.gap, open.find((r) => keyOf(r) === e.target.value)), key: e.target.value })}>
                <option value="" disabled>Pick a task due today</option>
                {open.map((r) => <option key={keyOf(r)} value={keyOf(r)}>{r.title}</option>)}
              </select>
              <input value={pick.title} aria-label="Event title" placeholder="Event title" onChange={(e) => setPick({ ...pick, title: e.target.value })} />
              <div className="dp-when">
                <input type="time" value={pick.start} aria-label="Start" min={clock(pick.gap[0])} max={clock(pick.gap[1])} onChange={(e) => setPick({ ...pick, start: e.target.value })} />
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
