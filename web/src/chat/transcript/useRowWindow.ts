import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { forgetSeenBefore, getState, loadEarlier, seenBefore, useStore } from '../../app/store';
import { FIRST_ROWS, needsEarlier, revealMore, stageRows, windowStart } from './window';
import { ROW_WINDOW } from '../../../../shared/protocol';

export function useSeenMark() {
  const seenTimes = useStore((s) => s.seen);
  const [mark, setMark] = useState(() => ({ seen: -1, openedAt: Date.now() }));
  // After a reload the seen times arrive after mount, so the mark waits for them.
  useEffect(() => {
    const id = getState().session.sessionId;
    if (mark.seen >= 0 || !id || seenBefore(id) < 0) return;
    setMark({ ...mark, seen: seenBefore(id) });
    forgetSeenBefore(id);
  }, [seenTimes, mark]);
  return mark;
}

// How many rows are shown, staged in over idle time, and loaded from earlier history on request.
export function useRowWindow(count: number, replies: number, earlier: number, box: RefObject<HTMLDivElement | null>, stick: RefObject<boolean>) {
  const [shown, setShown] = useState(ROW_WINDOW);
  const [staged, setStaged] = useState(FIRST_ROWS);
  const grew = useRef(0);
  const [loading, setLoading] = useState(false);
  const start = windowStart(count, shown);
  const from = windowStart(count, Math.min(staged, shown));
  const staging = staged < Math.min(shown, count);

  useLayoutEffect(() => {
    const el = box.current;
    const delta = el ? el.scrollHeight - grew.current : 0;
    if (el && grew.current && delta) {
      el.scrollTop += delta;
      grew.current = 0;
    }
  }, [shown, staged, count]);

  useEffect(() => {
    if (!staging) return;
    const step = () => {
      if (!stick.current) grew.current = box.current?.scrollHeight ?? 0;
      setStaged(stageRows(staged, shown));
    };
    if (typeof requestIdleCallback === 'function') {
      const h = requestIdleCallback(step, { timeout: 200 });
      return () => cancelIdleCallback(h);
    }
    const h = setTimeout(step, 50);
    return () => clearTimeout(h);
  }, [staging, staged, shown]);

  const showEarlier = async (auto = false) => {
    if (loading) return false;
    // A page loaded by itself leaves a reader at the bottom there.
    const mark = () => { if (!(auto && stick.current)) grew.current = box.current?.scrollHeight ?? 0; };
    if (start > 0) {
      mark();
      const next = revealMore(shown, count);
      setShown(next);
      setStaged(next);
      return true;
    }
    setLoading(true);
    const ok = await loadEarlier();
    setLoading(false);
    // Marked only now: rows streamed in at the bottom during the load would otherwise spend the mark.
    if (ok) { mark(); setShown(shown + ROW_WINDOW); setStaged(shown + ROW_WINDOW); }
    return ok;
  };

  const autoLoads = useRef({ n: 0, failed: false });
  useEffect(() => {
    if (loading || autoLoads.current.failed || !needsEarlier(replies, earlier, autoLoads.current.n)) return;
    autoLoads.current.n++;
    showEarlier(true).then((ok) => { if (!ok) autoLoads.current.failed = true; });
  }, [replies, earlier, loading]);

  // Widens the window to the last `rows` rows.
  const reveal = (rows: number) => {
    if (rows <= Math.min(staged, shown)) return;
    const next = Math.max(shown, rows);
    setShown(next);
    setStaged(next);
  };

  return { shown, start, from, staging, loading, showEarlier, reveal };
}
