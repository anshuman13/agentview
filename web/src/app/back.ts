import { useEffect, useRef } from 'react';

// Each open layer (sheet, drawer, detail page) owns one history entry so the phone back button closes it instead of leaving the app.
// history.state.av is the depth of our entries; the stack holds the close callbacks, topmost last.
const stack: (() => void)[] = [];
const depth = () => (history.state?.av as number | undefined) ?? 0;
let ready = false;
let settle: ReturnType<typeof setTimeout> | undefined;

function init() {
  if (ready) return;
  ready = true;
  // After a reload with layers open, drop their stale entries so the next back press is not lost.
  if (depth()) history.go(-depth());
  window.addEventListener('popstate', () => {
    while (stack.length > depth()) {
      try { stack.pop()!(); } catch (err) { console.error(err); }
    }
  });
}

// Layers closed by the UI leave extra entries behind; drop them in one step after the tick, so a layer replaced in the same tick keeps its entry.
const trim = () => {
  clearTimeout(settle);
  settle = setTimeout(() => { const extra = depth() - stack.length; if (extra > 0) history.go(-extra); });
};

export function pushBack(close: () => void) {
  init();
  history.pushState({ ...history.state, av: depth() + 1 }, '');
  stack.push(close);
  return () => {
    const i = stack.lastIndexOf(close);
    if (i >= 0) stack.splice(i, 1);
    trim();
  };
}

export function useBack(close: () => void) {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => pushBack(() => latest.current()), []);
}

export function Back({ close }: { close: () => void }) {
  useBack(close);
  return null;
}
