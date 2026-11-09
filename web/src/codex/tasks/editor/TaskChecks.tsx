import { Fragment, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { Icon } from '../../../ui/Icon';
import { Button } from '../../../ui/Button';
import { haptic } from '../../../ui/haptic';
import { useDrag } from '../../gestures/drag';
import { addCheck, checkItems, moveCheck, toggleCheck } from './taskChecklist';

type Props = { text: string; putText: (text: string) => void; scroller: RefObject<HTMLDivElement | null> };

export function TaskChecks({ text, putText, scroller }: Props) {
  const checks = checkItems(text);
  const [adding, setAdding] = useState(false);
  const subRef = useRef<HTMLInputElement>(null);
  const addSub = () => {
    const el = subRef.current;
    if (!el) return;
    const label = el.value;
    el.value = '';
    if (label.trim()) putText(addCheck(text, label));
  };
  const reorder = (from: number, to: number) => {
    const next = moveCheck(text, from, to);
    if (next === text) return false;
    putText(next);
    return true;
  };
  const { drag, start } = useDrag<number>((from, d) => { if (d.section === 'checks') reorder(from, d.index); }, scroller, 'sub');
  const over = drag?.over?.section === 'checks' ? drag.over.index : -1;
  const gap = <div key="gap" className="as-check-gap" />;
  // Ticking a checklist line flips its box in the notes and saves at once.
  const toggle = (n: number) => { putText(toggleCheck(text, n)); haptic('tap'); };
  const subKey = (e: KeyboardEvent, i: number) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(i); }
    else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const to = e.key === 'ArrowUp' ? i - 1 : i + 1;
      if (reorder(i, to)) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-sub="${to}"]`)?.focus());
    }
  };
  const subInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      if (!e.metaKey && !e.ctrlKey) e.preventDefault();
      addSub();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      e.currentTarget.value = '';
      setAdding(false);
    }
  };

  return (
    <div className="as-edit-checks" data-drop="checks">
      {checks.map((c, i) => (
        <Fragment key={i}>
          {drag && i !== drag.item && over === i - (i > drag.item ? 1 : 0) && gap}
          <div
            role="checkbox"
            aria-checked={c.done}
            tabIndex={0}
            data-sub={i}
            className={[c.done && 'on', drag?.item === i && 'lifted'].filter(Boolean).join(' ') || undefined}
            onMouseDown={(e) => e.preventDefault()}
            onPointerDown={checks.length > 1 ? start(i, String(i), c.label) : undefined}
            onClick={() => toggle(i)}
            onKeyDown={(e) => subKey(e, i)}
          >
            <Icon name={c.done ? 'pass-filled' : 'circle-large-outline'} small /> <span>{c.label || '(empty)'}</span>
          </div>
        </Fragment>
      ))}
      {drag && over === checks.length - 1 && gap}
      {adding && <input ref={subRef} className="as-sub-input" autoFocus aria-label="New subtask" placeholder="Subtask" enterKeyHint="done" onKeyDown={subInputKey} onBlur={() => { addSub(); setAdding(false); }} />}
      <Button variant="quiet" size="sm" icon="add" className="as-tt-add" onMouseDown={(e) => e.preventDefault()} onClick={() => setAdding(true)}>Add subtask</Button>
    </div>
  );
}
