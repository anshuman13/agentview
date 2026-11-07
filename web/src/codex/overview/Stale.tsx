import type { ItemRow } from '../data/sync';
import { useActions } from '../useActions';
import { Capped, SectionHead } from '../Fold';
import { IconButton } from '../../ui/Button';
import { Row } from '../../ui/Row';
import { haptic } from '../../ui/haptic';
import { openTask } from '../view';

export function Stale({ rows, now, snooze }: { rows: ItemRow[]; now: number; snooze: (r: ItemRow) => void }) {
  const act = useActions();
  if (!rows.length) return null;
  return (
    <section>
      <SectionHead title="Stale" count={rows.length} />
      <div className="as-group">
        <Capped items={rows} render={(r) => (
          <Row key={r.profile + r.id} plain title={
            <button className="as-stale-open" onClick={() => openTask(r)}>
              <span className="ui-row-title">{r.title}</span>
              <span className="ui-row-meta">untouched {Math.floor((now - r.updated_at) / 86400000)} days</span>
            </button>
          } trailing={
            <>
              <IconButton icon="circle-large-outline" label={`Mark ${r.title} done`} size="sm" onClick={() => { haptic('success'); act.done(r); }} />
              <IconButton icon="clock" label={`Snooze ${r.title} to tomorrow`} title="Tomorrow 09:00" size="sm" onClick={() => snooze(r)} />
            </>
          } />
        )} />
      </div>
    </section>
  );
}
