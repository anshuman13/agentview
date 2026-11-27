import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { LiveChat } from '../../../shared/protocol';
import { touch } from '../app/touch/touch';
import { CardChat } from '../chat/cards/cardChat';
import { PendingCard } from '../chat/cards/Pending';

// Claude.app's hover card on a waiting row: answer the chat's first request without opening it.
export function AskHover({ c, children }: { c: LiveChat; children: ReactNode }) {
  const [top, setTop] = useState<{ y: number; x: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const later = (f: () => void, ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(f, ms);
  };
  const show = (el: HTMLElement, ms: number) => {
    const r = el.getBoundingClientRect();
    later(() => setTop({ y: Math.max(8, Math.min(r.top, window.innerHeight * 0.5)), x: r.right + 8 }), ms);
  };
  const hide = () => later(() => setTop(null), 200);
  const keep = () => clearTimeout(timer.current);
  useEffect(() => { if (!c.request) setTop(null); }, [c.request]);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!c.request || touch()) return children;
  return (
    <div
      onMouseEnter={(e) => show(e.currentTarget, 400)}
      onMouseLeave={hide}
      onFocus={(e) => (e.currentTarget.contains(e.target) ? show(e.currentTarget, 0) : keep())}
      onBlur={hide}
      onKeyDown={(e) => e.key === 'Escape' && setTop(null)}
    >
      {children}
      {top && createPortal(
        <div className="ask-hover" style={{ top: top.y, left: top.x, maxHeight: `calc(100vh - ${top.y + 8}px)` }} onMouseEnter={keep} onMouseLeave={hide}>
          <div className="ask-hover-title">{c.title}</div>
          <CardChat.Provider value={c.id}>
            <PendingCard p={c.request} mode="" first={false} />
          </CardChat.Provider>
        </div>,
        document.body,
      )}
    </div>
  );
}
