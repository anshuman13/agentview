import { useState, type ReactNode } from 'react';
import { save, stored } from '../ui/util';
import { Icon } from '../ui/Icon';

// A folded group of Overview sections: the header shows the total count, and open or closed is remembered.
export function Fold({ id, title, count, children }: { id: string; title: string; count: number; children: ReactNode }) {
  const key = `codex.fold.${id}`;
  const [open, setOpen] = useState(() => stored(key, false));
  if (!count) return null;
  const toggle = () => { save(key, !open); setOpen(!open); };
  return (
    <section>
      <button className="as-section as-toggle later" aria-expanded={open} onClick={toggle}>
        {title} <span>{count}</span> <Icon name={open ? 'chevron-up' : 'chevron-down'} small />
      </button>
      {open && <div className="ov-fold">{children}</div>}
    </section>
  );
}
