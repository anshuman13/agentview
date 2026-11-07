import { useEffect, useRef, useState } from 'react';
import { useAssistantStore, useAssistantTable } from './data';
import { normaliseNote, planNoteWrite, wrapNoteId, wrapNoteProfile } from './data/wrapNote';
import { ymd } from './data/dates';
import { UNROLL, unrollFor } from './useActions';
import { SNOOZES, atTime, nextNine } from './data/engine';
import type { ItemRow, Profile } from './data/sync';
import { plural } from '../ui/util';
import { Button, IconButton } from '../ui/Button';
import { Menu, MenuItem } from '../ui/Menu';
import { Row } from '../ui/Row';
import { Section } from '../ui/Section';
import { haptic } from '../ui/haptic';
import { showSnack } from './view';
import { when } from './time';

const SHUTDOWN_HOUR = 16;

export const wrapUpDue = (open: ItemRow[], now: number) => new Date(now).getHours() >= SHUTDOWN_HOUR && open.length > 0;

// From 16:00 until midnight: an Open tasks section to move, snooze or drop, a Done today row, and the note.
// One line saved to today's wrapup brief for the profile, shown first in the next morning brief; a draft left behind by a profile switch is saved first.
function WrapNote({ profile, now }: { profile: Profile; now: number }) {
  const store = useAssistantStore();
  const rows = useAssistantTable('briefs');
  const id = wrapNoteId(now);
  const existing = rows.find((b) => b.profile === profile && b.id === id && !b.deleted);
  const [draft, setDraft] = useState(existing?.text ?? '');
  const latest = useRef({ rows, draft, last: existing?.text ?? '' });
  latest.current.rows = rows;
  latest.current.draft = draft;
  const save = () => {
    const l = latest.current;
    if (normaliseNote(l.draft) === l.last) return;
    l.last = normaliseNote(l.draft);
    const w = planNoteWrite(l.rows.find((b) => b.profile === profile && b.id === id), l.draft, profile, Date.now());
    if (w) void store.editRow('briefs', w.row, w.patch);
  };
  useEffect(() => save, []);
  return <input className="as-input" value={draft} maxLength={400} placeholder="Note for tomorrow" aria-label="Note for tomorrow" onChange={(e) => setDraft(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && save()} />;
}

const SHOWN = 5;

function TaskRow({ r, tomorrow, snooze, change }: { r: ItemRow; tomorrow: number; snooze: () => void; change: (patch: Partial<ItemRow>, text: string) => void }) {
  const [menu, setMenu] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const at = atTime(r.at);
  return (
    <Row plain title={r.title} meta={at != null ? when(at) : undefined} trailing={
      <>
        <Button size="sm" aria-label={`Move ${r.title} to tomorrow`} onClick={() => change({ at: tomorrow, ...UNROLL }, `Moved to ${when(tomorrow)}`)}>Tomorrow</Button>
        <span className="as-wrap-more">
          <IconButton ref={btn} icon="kebab-vertical" label="More" size="sm" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
          {menu && (
            <Menu trigger={btn} onClose={() => setMenu(false)}>
              <MenuItem onClick={() => { setMenu(false); snooze(); }}>Snooze 1 hour</MenuItem>
              <MenuItem danger onClick={() => { setMenu(false); change({ deleted: 1 }, 'Dropped'); }}>Drop</MenuItem>
            </Menu>
          )}
        </span>
      </>
    } />
  );
}

export function Shutdown({ open, done, now, profile }: { open: ItemRow[]; done: number; now: number; profile: Profile | 'all' }) {
  const store = useAssistantStore();
  const [all, setAll] = useState(false);
  if (!wrapUpDue(open, now)) return null;
  const tomorrow = (r: ItemRow) => nextNine(new Date(now), r.profile);
  const change = (rs: ItemRow[], patch: Partial<ItemRow>, text: string) => {
    haptic('tap');
    const before = rs.map((r) => [r, Object.fromEntries(Object.keys(patch).map((k) => [k, r[k as keyof ItemRow]]))] as const);
    for (const r of rs) void store.update(r, patch);
    showSnack(text, () => before.forEach(([r, b]) => void store.update(r, b)));
  };
  const moveAll = () => {
    haptic('tap');
    const before = open.map((r) => [r, { at: r.at, rolls: r.rolls, rolled_from: r.rolled_from }] as const);
    for (const r of open) void store.update(r, { at: tomorrow(r), ...UNROLL });
    showSnack(`Moved ${plural(open.length, 'task')} to ${when(Math.min(...open.map(tomorrow)))}`, () => before.forEach(([r, b]) => void store.update(r, b)));
  };
  const snooze = (r: ItemRow) => {
    const at = SNOOZES[0].at(new Date(now), r.profile);
    change([r], { at, ...unrollFor(at, now) }, `Snoozed to ${when(at)}`);
  };
  const shown = all ? open : open.slice(0, SHOWN);
  return (
    <>
      <Section label="Open tasks" count={open.length} action={<Button variant="quiet" size="sm" onClick={moveAll}>Move all to tomorrow</Button>} />
      <div className="as-group">
        {shown.map((r) => <TaskRow key={r.profile + r.id} r={r} tomorrow={tomorrow(r)} snooze={() => snooze(r)} change={(patch, text) => change([r], patch, text)} />)}
        {open.length > shown.length && <Button variant="quiet" size="sm" onClick={() => setAll(true)}>Show all {open.length}</Button>}
        <Row plain title="Done today" meta={`${done} done`} />
      </div>
      <Section label="Note for tomorrow" />
      <div className="as-group">
        <Row plain title={<WrapNote key={`${wrapNoteProfile(profile)}:${ymd(now)}`} profile={wrapNoteProfile(profile)} now={now} />} />
      </div>
    </>
  );
}
