import { useEffect, useRef, useState } from 'react';
import { useAssistantStore, useAssistantTable } from './data';
import { normaliseNote, planNoteWrite, wrapNoteId, wrapNoteProfile } from './data/wrapNote';
import { ymd } from './data/dates';
import { UNROLL, unrollFor } from './useActions';
import { SNOOZES, nextNine } from './data/engine';
import type { ItemRow, Profile } from './data/sync';
import { plural } from '../ui/util';
import { Icon } from '../ui/Icon';
import { Capped, Fold } from './Fold';
import { haptic } from '../ui/haptic';
import { showSnack } from './view';
import { when } from './time';

const SHUTDOWN_HOUR = 16;

export const wrapUpDue = (open: ItemRow[], now: number) => new Date(now).getHours() >= SHUTDOWN_HOUR && open.length > 0;

// From 16:00 until midnight: one row with today's done and open counts and Move all; the header opens the first open tasks to move, snooze or drop.
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

export function Shutdown({ open, done, now, profile }: { open: ItemRow[]; done: number; now: number; profile: Profile | 'all' }) {
  const store = useAssistantStore();
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
  return (
    <>
      <Fold id="shutdown" remember={false} title={`Wrap up · ${done} done · ${open.length} open`}>
        <div className="ov-follow">
          <Capped items={open} render={(r) => (
            <div key={r.profile + r.id} className="ov-follow-row">
              <span className="ov-follow-text"><span className="ov-t">{r.title}</span></span>
              <button className="ov-check" aria-label={`Move ${r.title} to tomorrow`} title="Tomorrow 09:00" onClick={() => change([r], { at: tomorrow(r), ...UNROLL }, `Moved to ${when(tomorrow(r))}`)}><Icon name="arrow-right" small /></button>
              <button className="ov-check" aria-label={`Snooze ${r.title} 1 hour`} title="In 1 hour" onClick={() => snooze(r)}><Icon name="history" small /></button>
              <button className="ov-check" aria-label={`Drop ${r.title}`} title="Drop" onClick={() => change([r], { deleted: 1 }, 'Dropped')}><Icon name="trash" small /></button>
            </div>
          )} />
        </div>
      </Fold>
      <div className="ov-follow">
        <button className="ov-follow-row ov-follow-text" onClick={() => moveAll()}>Move all to tomorrow</button>
        <div className="ov-follow-row"><WrapNote key={`${wrapNoteProfile(profile)}:${ymd(now)}`} profile={wrapNoteProfile(profile)} now={now} /></div>
      </div>
    </>
  );
}
