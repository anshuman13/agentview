import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Back } from '../app/touch/back';
import { useEscape, useReturnFocus } from './util';
import { useSheetDrag } from './useSheetDrag';

const stack: object[] = [];
export const sheetOpen = () => stack.length > 0;

// With `onBack`, Esc and the touch Back call it instead of closing the sheet; the scrim and drag still close.
export function Sheet({ label, onClose, onBack, className, overlayClassName, active = true, noSwipe, children }: { label: string; onClose: () => void; onBack?: () => void; className?: string; overlayClassName?: string; active?: boolean; noSwipe?: boolean; children: ReactNode }) {
  const sheet = useSheetDrag(true, onClose);
  const id = useRef({});
  useEffect(() => {
    if (!active) return;
    const me = id.current;
    stack.push(me);
    return () => { stack.splice(stack.lastIndexOf(me), 1); };
  }, [active]);
  useReturnFocus();
  // Each Back press pops its history entry, so `backs` remounts Back to push a new one while the sheet stays open.
  const [backs, setBacks] = useState(0);
  const goBack = onBack && (() => { setBacks((n) => n + 1); onBack(); });
  useEscape(() => { if (stack[stack.length - 1] === id.current) (goBack ?? sheet.close)(); });
  return createPortal(
    <div className={overlayClassName ?? 'as-sheet-overlay'} ref={sheet.overlay} onClick={sheet.close}>
      {active && <Back key={goBack ? `back${backs}` : 'close'} close={goBack ?? onClose} />}
      <div className={className ? `as-sheet ${className}` : 'as-sheet'} ref={sheet.sheet} role="dialog" aria-label={label} onClick={(e) => e.stopPropagation()} data-no-swipe={noSwipe || undefined}>
        <div className="sheet-handle" {...sheet.handle} />
        {children}
      </div>
    </div>,
    document.body,
  );
}
