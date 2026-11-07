import { useMemo } from 'react';
import { useAssistant } from './data';
import { tagTasks } from './data/tagTasks';
import { rowKey } from './data/sync';
import { Icon } from '../ui/Icon';
import { EmptyState } from '../ui/Panel';
import { Section } from '../ui/Section';
import { setView, useEscapeBack } from './view';
import { TaskRow } from './Task';
import { SnackBar } from './SnackBar';

export function TagPage({ tag }: { tag: string }) {
  const { snap } = useAssistant();
  const back = () => setView({ tag: null });
  useEscapeBack(back);
  const rows = useMemo(() => tagTasks(snap.items, tag), [snap.items, tag]);
  return (
    <div className="assistant tasks">
      <header className="as-head">
        <button className="icon-btn" title="Back" aria-label="Back" onClick={back}><Icon name="arrow-left" /></button>
        <div className="as-title-wrap">
          <button className="as-crumb" onClick={back}>Tasks</button>
        </div>
      </header>
      <div className="as-scroll">
        <Section label={`#${tag}`} count={rows.length || undefined} />
        {rows.length ? (
          <div className="as-list grouped">
            {rows.map((r) => <TaskRow key={r.profile + r.id} row={r} onOpen={() => setView({ open: rowKey(r) })} />)}
          </div>
        ) : <EmptyState size="sm" title={`No open tasks with #${tag}`} />}
      </div>
      <SnackBar />
    </div>
  );
}
