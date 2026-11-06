import { useMemo } from 'react';
import { useAssistant } from './data';
import { tagTasks } from './data/tagTasks';
import { rowKey } from './data/sync';
import { Icon } from '../ui/Icon';
import { plural } from '../ui/util';
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
          <h1>#{tag}</h1>
          <div className="as-dayline">{plural(rows.length, 'open task')}</div>
        </div>
      </header>
      <div className="as-scroll">
        {rows.length ? (
          <div className="as-list">
            {rows.map((r) => <TaskRow key={r.profile + r.id} row={r} onOpen={() => setView({ open: rowKey(r) })} />)}
          </div>
        ) : <div className="as-empty muted small">No open tasks with #{tag}</div>}
      </div>
      <SnackBar />
    </div>
  );
}
