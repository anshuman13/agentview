import { useRef, useState } from 'react';
import { Icon } from '../ui/Icon';
import { haptic } from '../ui/haptic';
import { isDragging } from './drag';

const SWIPE = 80;
// A left swipe past this share of the row deletes instead of snoozing.
const SWIPE_DELETE = 0.55;

export function Swipe({ onRight, onLeft, leftLabel = 'Tomorrow', onDelete, children }: { onRight?: () => void; onLeft?: () => void; leftLabel?: string; onDelete: () => void; children: React.ReactNode }) {
  const [dx, setDx] = useState(0);
  const width = useRef(1);
  const deleting = dx < 0 && (!onLeft || -dx > width.current * SWIPE_DELETE);
  const from = useRef<{ x: number; y: number } | null>(null);
  const moving = useRef(false);
  const swiped = useRef(false);
  const reset = () => { from.current = null; moving.current = false; setDx(0); };
  return (
    <div className={`as-swipe${dx > 0 ? ' right' : dx < 0 ? (deleting ? ' left delete' : ' left') : ''}`}>
      <div className="as-swipe-bg"><span><Icon name="check" /> Done</span>{deleting ? <span>Delete <Icon name="trash" /></span> : <span>{leftLabel} <Icon name="clock" /></span>}</div>
      <div
        className="as-swipe-row"
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: moving.current ? 'none' : undefined }}
        onPointerDown={(e) => { if (e.pointerType !== 'mouse') { from.current = { x: e.clientX, y: e.clientY }; width.current = e.currentTarget.offsetWidth || 1; } }}
        onPointerMove={(e) => {
          if (!from.current) return;
          if (isDragging()) return reset();
          const mx = e.clientX - from.current.x;
          if (!moving.current) {
            if (Math.abs(e.clientY - from.current.y) > 10 && Math.abs(e.clientY - from.current.y) > Math.abs(mx)) { from.current = null; return; }
            if (Math.abs(mx) < 10) return;
            moving.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
          }
          setDx(mx > 0 ? (onRight ? mx : 0) : mx);
        }}
        onPointerUp={() => {
          if (moving.current) { swiped.current = true; setTimeout(() => { swiped.current = false; }, 0); }
          const fire = (f?: () => void) => { haptic('tap'); f?.(); };
          if (moving.current && dx > SWIPE) fire(onRight);
          else if (moving.current && deleting && -dx > SWIPE) fire(onDelete);
          else if (moving.current && dx < -SWIPE) fire(onLeft);
          reset();
        }}
        onPointerCancel={reset}
        onClickCapture={(e) => { if (swiped.current) e.stopPropagation(); }}
      >
        {children}
      </div>
    </div>
  );
}
