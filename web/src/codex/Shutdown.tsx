import { useAssistantStore } from './data';
import { UNROLL } from './Task';
import { SNOOZES, nextNine } from './data/engine';
import type { ItemRow } from './data/sync';
import { plural } from '../ui/util';
import { Icon } from '../ui/Icon';
import { haptic } from '../ui/haptic';
import { showSnack } from './view';
import { when } from './time';

const SHUTDOWN_HOUR = 16;

// From 16:00 until midnight: tasks done today and the open ones due today or overdue, each moved, snoozed or dropped.
export function Shutdown({ open, done, now }: { open: ItemRow[]; done: number; now: number }) {
  const store = useAssistantStore();
  if (new Date(now).getHours() < SHUTDOWN_HOUR || !open.length) return null;
  const tomorrow = nextNine(new Date(now));
  const change = (rs: ItemRow[], patch: Partial<ItemRow>, text: string) => {
    haptic('tap');
    const before = rs.map((r) => [r, Object.fromEntries(Object.keys(patch).map((k) => [k, r[k as keyof ItemRow]]))] as const);
    for (const r of rs) void store.update(r, patch);
    showSnack(text, () => before.forEach(([r, b]) => void store.update(r, b)));
  };
  const snooze = (r: ItemRow) => {
    const at = SNOOZES[0].at(new Date(now));
    change([r], { at, ...UNROLL }, `Snoozed to ${when(at)}`);
  };
  return (
    <section>
      <div className="as-section">Wrap up · {plural(done, 'task')} done today</div>
      <div className="ov-follow">
        {open.map((r) => (
          <div key={r.profile + r.id} className="ov-follow-row">
            <span className="ov-follow-text"><span className="ov-t">{r.title}</span></span>
            <button className="ov-check" aria-label={`Move ${r.title} to tomorrow`} title="Tomorrow 09:00" onClick={() => change([r], { at: tomorrow, ...UNROLL }, `Moved to ${when(tomorrow)}`)}><Icon name="arrow-right" small /></button>
            <button className="ov-check" aria-label={`Snooze ${r.title} 1 hour`} title="In 1 hour" onClick={() => snooze(r)}><Icon name="clock" small /></button>
            <button className="ov-check" aria-label={`Drop ${r.title}`} title="Drop" onClick={() => change([r], { deleted: 1 }, 'Dropped')}><Icon name="trash" small /></button>
          </div>
        ))}
        <button className="ov-follow-row ov-follow-text" onClick={() => change(open, { at: tomorrow, ...UNROLL }, `Moved ${plural(open.length, 'task')} to ${when(tomorrow)}`)}>Move all to tomorrow</button>
      </div>
    </section>
  );
}
