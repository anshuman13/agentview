import { useEffect, useRef, useState, type RefObject } from 'react';
import { getState } from '../../app/store';
import { catchUp, markSeen, readSeen, recap, recapText } from '../../chat/transcript/recap';
import type { ChatEvent } from '../../../../shared/protocol';

// On opening a chat, sum what happened after the last event this browser saw; then keep the seen id current while the chat is on screen.
export function useRecap(sessionId: string, events: ChatEvent[], waiting: boolean, root: RefObject<HTMLDivElement | null>) {
  const recapFor = useRef('');
  const [since, setSince] = useState<{ chat: string; lines: string[] } | null>(null);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const lastId = events.at(-1)?.id;
  const mark = () => { if (document.visibilityState === 'visible' && root.current?.getClientRects().length) markSeen(sessionId, eventsRef.current); };
  useEffect(() => {
    if (!sessionId || !lastId) return;
    if (recapFor.current !== sessionId) {
      recapFor.current = sessionId;
      const seen = readSeen(sessionId);
      const r = recap(eventsRef.current, seen, waiting);
      const rounds = getState().runs.filter((x) => x.chatId === sessionId).flatMap((x) => x.rounds);
      const lines = [r && recapText(r), catchUp(eventsRef.current, seen, rounds)].filter((l): l is string => !!l);
      setSince(lines.length ? { chat: sessionId, lines } : null);
    }
    mark();
  }, [sessionId, lastId]);
  useEffect(() => {
    if (!sessionId) return;
    document.addEventListener('visibilitychange', mark);
    return () => document.removeEventListener('visibilitychange', mark);
  }, [sessionId]);
  const dismiss = () => { markSeen(sessionId, events); setSince(null); };
  return { since, dismiss };
}

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

