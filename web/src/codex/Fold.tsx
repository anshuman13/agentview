import { useState, type ReactNode } from 'react';
import { save, stored } from '../ui/util';
import { Icon } from '../ui/Icon';

// A folded group: the header shows the title and count, and open or closed is remembered by id unless remember is false.
export function Fold({ id, title, count, remember = true, action, children }: { id: string; title: string; count?: number; remember?: boolean; action?: ReactNode; children: ReactNode }) {
  const key = `codex.fold.${id}`;
  const [open, setOpen] = useState(() => remember && stored<boolean>(key, false));
  if (count === 0) return null;
  const toggle = () => { if (remember) save(key, !open); setOpen(!open); };
  const head = (
    <button className="as-section as-toggle later" aria-expanded={open} onClick={toggle}>
      {title}{count ? <> <span>{count}</span></> : null} <Icon name={open ? 'chevron-up' : 'chevron-down'} small />
    </button>
  );
  return (
    <section>
      {action ? <div className="ov-brief-head">{head}{action}</div> : head}
      {open && <div className="ov-fold">{children}</div>}
    </section>
  );
}

const SHOWN = 5;

// The first rows of a list with a +N more button that expands in place and Show fewer after.
export function Capped<T>({ items, render, limit = SHOWN }: { items: T[]; render: (item: T, i: number) => ReactNode; limit?: number }) {
  const [more, setMore] = useState(false);
  return (
    <>
      {(more ? items : items.slice(0, limit)).map(render)}
      {items.length > limit && <button className="as-chip quiet ov-more" onClick={() => setMore(!more)}>{more ? 'Show fewer' : `+${items.length - limit} more`}</button>}
    </>
  );
}
