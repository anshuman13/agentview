import { useEffect, useRef, type RefObject } from 'react';

// Keeps the status pane scrolled to the end while it is at the bottom.
export function useBriefScroll(root: RefObject<HTMLDivElement | null>, deps: { turns: number; next: number; running: boolean; waiting: boolean }, resetKey: unknown[]) {
  const end = useRef<HTMLDivElement>(null);
  // The end marker sits inside the sticky foot, so scrollIntoView never moves the list; scroll the pane itself.
  const scrollEnd = (always: boolean) => {
    const sc = end.current?.closest('.brief-status');
    if (sc && (always || sc.scrollHeight - sc.scrollTop - sc.clientHeight < 400)) sc.scrollTop = sc.scrollHeight;
  };
  useEffect(() => scrollEnd(false), [deps.turns, deps.next, deps.running, deps.waiting]);

  // Cards settle after the first paint (clipped replies, Markdown, the plan card), so a pane at the bottom follows them.
  // A scroll the browser makes because the content or pane changed size (a chat swap clamps it to the top) does not unstick it.
  useEffect(() => {
    const sc = root.current?.querySelector<HTMLElement>('.brief-status');
    if (!sc) return;
    let stick = true;
    let size = '';
    const measure = () => `${sc.scrollHeight},${sc.clientHeight}`;
    const onScroll = () => {
      const now = measure();
      if (now === size) stick = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80;
      size = now;
    };
    const ro = new ResizeObserver(() => { if (stick) sc.scrollTop = sc.scrollHeight; size = measure(); });
    ro.observe(sc);
    for (const c of sc.children) ro.observe(c);
    sc.addEventListener('scroll', onScroll);
    return () => { ro.disconnect(); sc.removeEventListener('scroll', onScroll); };
  }, resetKey);
  return end;
}

