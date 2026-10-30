import { useEffect, useState } from 'react';
import type { ItemRow } from './data/sync';
import { Icon } from '../ui/Icon';
import { haptic } from '../ui/haptic';
import { useActions } from './useActions';

export function Check({ row, onDone }: { row: ItemRow; onDone?: () => void }) {
  const act = useActions();
  const [checked, setChecked] = useState(false);
  useEffect(() => setChecked(false), [row.status]);
  const isDone = row.status === 'done';
  if (row.status === 'note') return <span className="as-check note"><Icon name="note" /></span>;
  const tick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDone) return act.reopen(row);
    if (checked) return;
    haptic('success');
    setChecked(true);
    setTimeout(() => { act.done(row); onDone?.(); }, 260);
  };
  return (
    <button className={`as-check${checked || isDone ? ' on' : ''}`} title={isDone ? 'Not done' : 'Done'} aria-label={isDone ? 'Not done' : 'Done'} onClick={tick}>
      <Icon name={checked || isDone ? 'pass-filled' : 'circle-large-outline'} />
    </button>
  );
}
