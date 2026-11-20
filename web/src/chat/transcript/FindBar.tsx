import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../ui/Icon';
import { IconButton } from '../../ui/Button';
import { stepMatch } from '../../ui/util';
import { findInChat } from '../../../../shared/findInChat';
import type { ChatEvent } from '../../../../shared/protocol';

const HIT = 'find-hit';

const clearHit = () => document.querySelectorAll(`.${HIT}`).forEach((el) => el.classList.remove(HIT));

export function markHit(el: HTMLElement) {
  clearHit();
  el.classList.add(HIT);
}

export const findLabel = (cur: number, count: number, earlier: number) => `${count ? `${cur + 1} of ${count}` : 'No matches'}${earlier > 0 ? ' · loaded only' : ''}`;

// The bar above the transcript: a field, the hit count, Previous and Next (Enter and Shift+Enter) and Close (Esc). `go` scrolls to a hit and returns a function that stops its retries.
export function FindBar({ events, earlier, go, onClose }: { events: ChatEvent[]; earlier: number; go: (id: string) => () => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [cur, setCur] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => findInChat(events, query), [events, query]);
  const at = Math.min(cur, Math.max(hits.length - 1, 0));
  useEffect(() => input.current?.focus(), []);
  const stop = useRef(() => {});
  const show = (to: number) => { stop.current(); stop.current = go(hits[to]); };
  useEffect(() => () => { stop.current(); clearHit(); }, []);
  useEffect(() => { if (hits.length) show(at); }, [query]);
  const step = (dir: 1 | -1) => {
    if (!hits.length) return;
    const to = stepMatch(at, dir, hits.length);
    setCur(to);
    show(to);
  };
  return (
    <div className="tr-find">
      <label className="jb-search">
        <Icon name="search" small />
        <input ref={input} value={query} placeholder="Find in chat" aria-label="Find in chat" onChange={(e) => { setQuery(e.target.value); setCur(0); }} onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
          else if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
        }} />
      </label>
      {query.trim().length >= 2 && <span className="muted small">{findLabel(at, hits.length, earlier)}</span>}
      <IconButton size="sm" icon="arrow-up" label="Previous match" disabled={!hits.length} onClick={() => step(-1)} />
      <IconButton size="sm" icon="arrow-down" label="Next match" disabled={!hits.length} onClick={() => step(1)} />
      <IconButton size="sm" icon="close" label="Close" onClick={onClose} />
    </div>
  );
}
