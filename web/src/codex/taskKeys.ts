import { atTime, nextNine } from './data/engine';
import type { ItemRow } from './data/sync';
import type { useActions } from './useActions';
import { setView } from './view';

// Keys on a focused task: j/k or arrows move, Enter or Space opens, x done or back to open, s snooze to the next morning, Delete removes.
export function rowKey(e: React.KeyboardEvent<HTMLElement>, row: ItemRow, onOpen: () => void, act: ReturnType<typeof useActions>) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const step = e.key === 'j' || e.key === 'ArrowDown' ? 1 : e.key === 'k' || e.key === 'ArrowUp' ? -1 : 0;
  const open = row.status === 'open' || row.status === 'suggested';
  if (step) {
    const rows = [...document.querySelectorAll<HTMLElement>('.tasks [data-row]')];
    rows[rows.indexOf(e.currentTarget) + step]?.focus();
  } else if (e.key === 'Enter' || e.key === ' ') onOpen();
  else if (e.key === 'x' && open) act.done(row);
  else if (e.key === 'x' && row.status === 'done') act.reopen(row);
  else if (e.key === 's' && open) act.snooze(row, nextNine(new Date(Math.max(atTime(row.at) ?? 0, Date.now())), row.profile));
  else if (e.key === 'Delete' || e.key === 'Backspace') act.remove(row);
  else return;
  e.preventDefault();
  // When done, snooze or delete takes the row away, focus moves to its neighbour.
  if (!step && e.key !== 'Enter' && e.key !== ' ') {
    const rows = [...document.querySelectorAll<HTMLElement>('.tasks [data-row]')];
    const i = rows.indexOf(e.currentTarget);
    const own = e.currentTarget.dataset.row;
    const key = (rows[i + 1] ?? rows[i - 1])?.dataset.row;
    // The store applies the change a moment later; a row that stays (as in search results) keeps focus.
    let tries = 0;
    const move = () => {
      if (!key) return;
      if (!document.querySelector(`[data-row="${own}"]`)) document.querySelector<HTMLElement>(`[data-row="${key}"]`)?.focus();
      else if (++tries < 20) requestAnimationFrame(move);
    };
    requestAnimationFrame(move);
  }
}

// With nothing focused, j or k on Tasks focuses the first task; n, from anywhere outside a field, starts a task for today.
document.addEventListener('keydown', (e) => {
  if ((e.key !== 'j' && e.key !== 'k' && e.key !== 'n') || e.metaKey || e.ctrlKey || e.altKey) return;
  const at = document.activeElement;
  if (e.key === 'n') {
    if (at && at !== document.body && !at.matches('[data-row]')) return;
    const add = () => window.dispatchEvent(new Event('tasks:add'));
    if (document.querySelector<HTMLElement>('.tasks')?.offsetParent != null) add();
    else if (document.querySelector<HTMLElement>('.assistant')?.offsetParent != null) {
      setView({ list: 'tasks', open: null, person: null });
      requestAnimationFrame(() => requestAnimationFrame(add));
    } else return;
    e.preventDefault();
    return;
  }
  if (at && at !== document.body) return;
  const first = document.querySelector<HTMLElement>('.tasks [data-row]');
  if (first?.offsetParent == null) return;
  e.preventDefault();
  first.focus();
});
