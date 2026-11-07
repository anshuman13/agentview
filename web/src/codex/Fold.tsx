import { useState, type ReactNode } from 'react';
import { save, stored } from '../ui/util';
import { Section } from '../ui/Section';
import { Chip } from '../ui/Button';

// The header line of an overview card: title, count and an optional control on the right.
export function SectionHead({ title, count, action, className = '', id }: { title: string; count?: number; action?: ReactNode; className?: string; id?: string }) {
  const text = <>{title}{count != null && <> · {count}</>}</>;
  return action ? <div id={id} className={`as-section ov-queue-top ${className}`.trim()}><span>{text}</span>{action}</div> : <div id={id} className={`as-section ${className}`.trim()}>{text}</div>;
}

// A folded group: the header shows the title and count, and open or closed is remembered by id unless remember is false.
export function Fold({ id, title, count, remember = true, action, onOpen, children }: { id: string; title: string; count?: number; remember?: boolean; action?: ReactNode; onOpen?: () => void; children: ReactNode }) {
  const key = `codex.fold.${id}`;
  const [open, setOpen] = useState(() => remember && stored<boolean>(key, false));
  if (count === 0) return null;
  const toggle = () => { if (remember) save(key, !open); if (!open) onOpen?.(); setOpen(!open); };
  return (
    <section>
      <Section label={title} count={count} open={open} onToggle={toggle} action={action} />
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
      {items.length > limit && <Chip quiet className="ov-more" onClick={() => setMore(!more)}>{more ? 'Show fewer' : `+${items.length - limit} more`}</Chip>}
    </>
  );
}
