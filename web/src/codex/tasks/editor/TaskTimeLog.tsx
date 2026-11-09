import { useAssistant } from '../../data';
import type { ItemRow } from '../../data/sync';
import { Button } from '../../../ui/Button';
import { showSnack } from '../../view';
import { clock } from '../time';
import { minutesText } from '../../data/tasks/plan';
import { parseLog, removeSession } from '../../data/tasks/timeLog';
import { Fold } from '../../Fold';

export function TaskTimeLog({ row }: { row: ItemRow }) {
  const { store, snap } = useAssistant();
  const spent = Number(row.spent) || 0;
  const sessions = parseLog(row.time_log).sort((a, b) => b.at - a.at);
  const byHand = spent - sessions.reduce((n, s) => n + s.min, 0);
  const removeTime = (id: string, min: number) => {
    if (snap.phase !== 'ready') return showSnack('Unlock Codex to remove the time');
    const before = { spent: row.spent ?? null, time_log: row.time_log ?? null };
    void store.update(row, removeSession(row.time_log, row.spent, id));
    showSnack(`Removed ${minutesText(min)}`, () => void store.update(row, before));
  };
  if (sessions.length === 0 && byHand <= 0) return null;
  return (
    <Fold id="time-log" title="Time log" count={sessions.length || undefined}>
      <div className="as-tt-log">
        {sessions.map((s) => (
          <div key={s.id}>
            <span>{new Date(s.at).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} {clock(s.at)}</span>
            <span>{minutesText(s.min)}</span>
            <Button variant="quiet" size="sm" icon="close" aria-label={`Remove ${minutesText(s.min)}`} onClick={() => removeTime(s.id, s.min)}>Remove</Button>
          </div>
        ))}
        {byHand > 0 && <div className="as-tt-log-rest"><span>Earlier or added by hand: {minutesText(byHand)}</span></div>}
      </div>
    </Fold>
  );
}
