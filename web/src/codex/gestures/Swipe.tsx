import { useRef, useState } from 'react';
import { Icon } from '../../ui/Icon';
import { haptic } from '../../ui/haptic';
import { isDragging } from './drag';

const SWIPE = 80;
// A left swipe past this share of the row deletes instead of snoozing.
const SWIPE_DELETE = 0.55;

type SwipeEnd = 'right' | 'left' | 'delete' | null;
// What a finger lifted after dx px (of a row width px wide) fires. Delete needs a left swipe past the delete share
// (or any left swipe when there is no left action); right needs its action, left needs its action.
export function swipeEnd(dx: number, width: number, has: { right: boolean; left: boolean; delete: boolean }): SwipeEnd {
  const deleting = has.delete && dx < 0 && (!has.left || -dx > width * SWIPE_DELETE);
  if (dx > SWIPE) return has.right ? 'right' : null;
  if (deleting && -dx > SWIPE) return 'delete';
  if (dx < -SWIPE) return has.left ? 'left' : null;
  return null;
}

export function Swipe({ onRight, onLeft, rightLabel = 'Done', rightIcon = 'check', leftLabel = 'Tomorrow', leftIcon = 'clock', onDelete, children }: { onRight?: () => void; onLeft?: () => void; rightLabel?: string; rightIcon?: string; leftLabel?: string; leftIcon?: string; onDelete?: () => void; children: React.ReactNode }) {
  const [dx, setDx] = useState(0);
  const width = useRef(1);
  const has = { right: !!onRight, left: !!onLeft, delete: !!onDelete };
  const deleting = has.delete && dx < 0 && (!has.left || -dx > width.current * SWIPE_DELETE);
  const from = useRef<{ x: number; y: number } | null>(null);
  const moving = useRef(false);
  const swiped = useRef(false);
  const reset = () => { from.current = null; moving.current = false; setDx(0); };
  return (
    <div className={`as-swipe${dx > 0 ? ' right' : dx < 0 ? (deleting ? ' left delete' : ' left') : ''}`}>
      <div className="as-swipe-bg"><span><Icon name={rightIcon} /> {rightLabel}</span>{deleting ? <span>Delete <Icon name="trash" /></span> : <span>{leftLabel} <Icon name={leftIcon} /></span>}</div>
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
          setDx(mx > 0 ? (onRight ? mx : 0) : onLeft || onDelete ? mx : 0);
        }}
        onPointerUp={() => {
          if (moving.current) { swiped.current = true; setTimeout(() => { swiped.current = false; }, 0); }
          const end = moving.current ? swipeEnd(dx, width.current, has) : null;
          if (end) { haptic('tap'); ({ right: onRight, left: onLeft, delete: onDelete })[end]?.(); }
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
