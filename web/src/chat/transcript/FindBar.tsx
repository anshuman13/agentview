import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../ui/Icon';
import { Button, IconButton } from '../../ui/Button';
import { stepMatch } from '../../ui/util';
import { loadEarlier, rootOf } from '../../app/store';
import { findInChat, findStart } from '../../../../shared/findInChat';
import { hitBeforeLoaded } from './window';
import type { ChatEvent } from '../../../../shared/protocol';

const HIT = 'find-hit';

const clearHit = () => document.querySelectorAll(`.${HIT}`).forEach((el) => el.classList.remove(HIT));

export function markHit(el: HTMLElement) {
  clearHit();
  el.classList.add(HIT);
}

export const findLabel = (cur: number, count: number, earlier: number) => `${count ? `${cur + 1} of ${count}` : 'No matches'}${earlier > 0 ? ' · loaded only' : ''}`;

export type FindRequest = { sessionId: string; query: string; at: number | null; sub?: string };

// A sidebar message hit waiting for its chat: the find bar opens on it once that chat shows. `here` is whether the chat is the one on screen.
let pending: FindRequest | null = null;

export function requestFind(r: FindRequest, here: boolean) {
  pending = r;
  if (here) window.dispatchEvent(new Event('agentview:find'));
}

// A hit in a sub-chat names the chat's root, which any of its sessions matches.
const forChat = (r: FindRequest | null, sessionId: string | null) => !!r && (r.sessionId === sessionId || r.sessionId === rootOf(sessionId));

export const findPending = (sessionId: string | null) => forChat(pending, sessionId);

export function takeFind(sessionId: string | null) {
  const r = forChat(pending, sessionId) ? pending : null;
  if (r) pending = null;
  return r;
}

// The bar above the transcript: a field, the hit count, Previous and Next (Enter and Shift+Enter) and Close (Esc); Load earlier takes their place while a query has no hit and earlier events exist. `go` scrolls to a hit and returns a function that stops its retries. `start` fills the query and picks the hit nearest its time.
export function FindBar({ events, earlier, start, go, onClose }: { events: ChatEvent[]; earlier: number; start: FindRequest | null; go: (id: string) => () => void; onClose: () => void }) {
  const [query, setQuery] = useState(start?.query ?? '');
  const [cur, setCur] = useState(() => (start ? findStart(events, findInChat(events, start.query, start.at), start.at) : 0));
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => findInChat(events, query, query === start?.query ? start.at : null), [events, query, start]);
  const at = Math.min(cur, Math.max(hits.length - 1, 0));
  const label = findLabel(at, hits.length, earlier);
  useEffect(() => input.current?.focus(), []);
  const stop = useRef(() => {});
  const show = (to: number) => { stop.current(); stop.current = go(hits[to]); };
  useEffect(() => () => { stop.current(); clearHit(); }, []);
  useEffect(() => { if (hits.length) show(at); }, [query]);
  // A sidebar hit before the loaded events loads earlier pages until its time is loaded, then goes to the hit nearest it.
  const [seeking, setSeeking] = useState(() => start != null && earlier > 0 && hitBeforeLoaded(events, start.query, start.at));
  const failed = useRef(false);
  useEffect(() => {
    if (!seeking || loading || !start) return;
    if (!failed.current && earlier > 0 && hitBeforeLoaded(events, start.query, start.at)) {
      setLoading(true);
      loadEarlier().then((ok) => { failed.current = !ok; }).finally(() => setLoading(false));
      return;
    }
    setSeeking(false);
    if (query !== start.query || !hits.length) return;
    const to = findStart(events, hits, start.at);
    setCur(to);
    show(to);
  }, [seeking, loading, events, earlier]);
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
      {query.trim().length >= 2 && <span className="muted small tr-find-count" title={label}>{label}</span>}
      {query.trim().length >= 2 && !hits.length && earlier > 0 ? (
        <Button size="sm" disabled={loading} onClick={() => { setLoading(true); loadEarlier().finally(() => setLoading(false)); }}>{loading ? 'Loading…' : 'Load earlier'}</Button>
      ) : (
        <>
          <IconButton size="sm" icon="arrow-up" label="Previous match" disabled={!hits.length} onClick={() => step(-1)} />
          <IconButton size="sm" icon="arrow-down" label="Next match" disabled={!hits.length} onClick={() => step(1)} />
        </>
      )}
      <IconButton size="sm" icon="close" label="Close" onClick={onClose} />
    </div>
  );
}
