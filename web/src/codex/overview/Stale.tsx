import type { ItemRow } from '../data/sync';
import { useActions } from '../useActions';
import { Capped } from '../Fold';
import { Icon } from '../../ui/Icon';
import { haptic } from '../../ui/haptic';
import { openTask } from '../view';

export function Stale({ rows, now, snooze }: { rows: ItemRow[]; now: number; snooze: (r: ItemRow) => void }) {
  const act = useActions();
  if (!rows.length) return null;
  return (
    <section>
      <div className="as-section">Stale · {rows.length}</div>
      <div className="ov-follow">
        <Capped items={rows} render={(r) => (
          <div key={r.profile + r.id} className="ov-follow-row">
            <button className="ov-follow-text" onClick={() => openTask(r)}>
              <span className="ov-t">{r.title}</span>
              <span className="muted small">untouched {Math.floor((now - r.updated_at) / 86400000)} days</span>
            </button>
            <button className="ov-check" aria-label={`Mark ${r.title} done`} onClick={() => { haptic('success'); act.done(r); }}><Icon name="circle-large-outline" small /></button>
            <button className="ov-check" aria-label={`Snooze ${r.title} to tomorrow`} title="Tomorrow 09:00" onClick={() => snooze(r)}><Icon name="clock" small /></button>
          </div>
        )} />
      </div>
    </section>
  );
}
