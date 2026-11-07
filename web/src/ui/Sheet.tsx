import { useEffect, useRef, type ReactNode } from 'react';
import { Back } from '../app/back';
import { useEscape } from './util';
import { useSheetDrag } from './useSheetDrag';

const stack: object[] = [];

export function Sheet({ label, onClose, className, overlayClassName, active = true, noSwipe, children }: { label: string; onClose: () => void; className?: string; overlayClassName?: string; active?: boolean; noSwipe?: boolean; children: ReactNode }) {
  const sheet = useSheetDrag(true, onClose);
  const id = useRef({});
  useEffect(() => {
    if (!active) return;
    const me = id.current;
    stack.push(me);
    return () => { stack.splice(stack.lastIndexOf(me), 1); };
  }, [active]);
  useEscape(() => { if (stack[stack.length - 1] === id.current) sheet.close(); });
  return (
    <div className={overlayClassName ?? 'as-sheet-overlay'} ref={sheet.overlay} onClick={sheet.close}>
      {active && <Back close={onClose} />}
      <div className={className ? `as-sheet ${className}` : 'as-sheet'} ref={sheet.sheet} role="dialog" aria-label={label} onClick={(e) => e.stopPropagation()} data-no-swipe={noSwipe || undefined}>
        <div className="sheet-handle" {...sheet.handle} />
        {children}
      </div>
    </div>
  );
}
