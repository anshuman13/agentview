import { useMemo, useState } from 'react';
import { useStore } from '../../app/store';
import { Icon } from '../../ui/Icon';
import { Panel } from '../../ui/Panel';
import { useCardOpen } from './useCardOpen';
import { latestTodos, todoCount, todoCurrent, todoProgress, type TodoItem } from '../../../../shared/todos';

const ICON: Record<TodoItem['status'], string> = { completed: 'check', in_progress: 'play', pending: 'circle-large-outline' };

// Claude's latest to-do list, pinned above the composer while work on it remains.
export function TodoCard() {
  const events = useStore((s) => s.events);
  const running = useStore((s) => s.session.running);
  const todos = useMemo(() => latestTodos(events), [events]);
  const chat = useStore((s) => s.session.id);
  const waiting = useStore((s) => s.pending.length > 0);
  const [local, setLocal] = useState(false);
  const phone = useCardOpen(`${chat}:todo`, waiting);
  if (!todos?.length) return null;
  const count = todoCount(todos);
  if (count.done === count.total && !running) return null;
  const current = todoCurrent(todos);
  const open = phone?.open ?? local;
  return (
    <Panel padding="sm" className="td">
      <button className="td-head" aria-expanded={open} onClick={phone?.toggle ?? (() => setLocal(!local))}>
        <Icon name="chevron-right" small />
        <span className="td-count">{todoProgress(count)}</span>
        {current && <span className="td-now">{current}</span>}
      </button>
      {open && (
        <ul className="td-list">
          {todos.map((t, i) => (
            <li key={i} className={`td-item ${t.status}`}><Icon name={ICON[t.status]} small />{t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}</li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
