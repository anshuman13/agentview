import { useEffect, useRef, useState } from 'react';
import type { Item } from './steps';
import type { ChatEvent } from '../../../../shared/protocol';

function lastUserId(items: Item[]) {
  for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === 'user') return items[i].id;
  return '';
}

// Follows the bottom of the rows while the reader stays there, and tracks how far behind they are when they scroll up.
export function useStickyScroll(items: Item[], last: ChatEvent | undefined, running: boolean) {
  const box = useRef<HTMLDivElement>(null);
  const rows = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const size = useRef('');
  const lastUser = useRef('');
  const [stuck, setStuck] = useState(true);
  const [behind, setBehind] = useState(false);
  const [leftAt, setLeftAt] = useState('');
  const pin = useRef(false);

  const lineTop = () => {
    const el = box.current;
    const line = el?.querySelector<HTMLElement>('.tr-new');
    return el && line ? line.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop : null;
  };

  // Puts the New line at the top; true when that moved the scroll.
  const place = () => {
    const el = box.current;
    const top = lineTop();
    if (!el || top === null || el.scrollTop === top) return false;
    const before = el.scrollTop;
    el.scrollTop = top;
    if (el.scrollTop === before) return false;
    size.current = '';
    return true;
  };

  // Opens at the New line, and keeps it there while rows above finish rendering, until the reader scrolls. New content that fits on screen leaves the chat at its end.
  const openAtLine = () => {
    const el = box.current;
    const top = lineTop();
    if (!el || top === null || top >= el.scrollHeight - el.clientHeight) return;
    lastUser.current = lastUserId(items);
    stick.current = false;
    pin.current = true;
    setStuck(false);
    setBehind(true);
    place();
  };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const mine = lastUserId(items);
    if (mine !== lastUser.current) {
      lastUser.current = mine;
      if (mine) { stick.current = true; pin.current = false; setStuck(true); }
    }
    if (stick.current) el.scrollTop = el.scrollHeight;
    // Setting the same value from an effect still costs React a second commit per streamed chunk.
    if (behind === stick.current) setBehind(!stick.current);
  }, [items.length, last, running]);

  // Rows grow after they render (Markdown loads late, images decode), so a chat that sticks to the bottom follows them.
  useEffect(() => {
    const el = box.current;
    if (!el || !rows.current) return;
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
      // A scroll event for the move still comes, and it must not read as the reader's.
      if (!(pin.current && place())) size.current = `${el.scrollHeight},${el.clientHeight}`;
    });
    ro.observe(el);
    ro.observe(rows.current);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    // The browser scrolls on its own when the content or box changes size; only a scroll at a steady size is the user's.
    const now = `${el.scrollHeight},${el.clientHeight}`;
    if (now !== size.current) { size.current = now; return; }
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    pin.current = false;
    if (stick.current && !near) setLeftAt(items[items.length - 1]?.id ?? '');
    stick.current = near;
    setStuck(near);
    if (near) setBehind(false);
  };

  const jump = () => {
    const el = box.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    stick.current = true;
    pin.current = false;
    setStuck(true);
    setBehind(false);
  };

  return { box, rows, stick, stuck, behind, leftAt, onScroll, jump, openAtLine };
}
