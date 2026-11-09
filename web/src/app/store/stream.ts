import { apiUrl, bundled } from '../api';
import { backoffDelay } from '../runtime/backoff';
import { cid, getState, set, setUi } from './core';
import { handle } from './handlers';
import { loadSeen } from './seen';
import { cache, view } from './view';

// Dev-only beacon logger installed by main.tsx.
const avlog = (ev: string) => (window as { avlog?: (e: string) => void }).avlog?.(ev);

let es: EventSource | null = null;
let streamChat = '';
let streamSession: string | null = null;
let lastId = '';
let retry: ReturnType<typeof setTimeout> | undefined;
let attempt = 0;
let hiddenAt = 0;
let heard = 0;
// The server sends a ping event every 20 s; a link that stays silent longer is dead even if the browser says open.
const SILENT_MS = 50_000;

// One EventSource per tab; the browser reconnects it and resumes from Last-Event-ID through the server's ring.
export function connect() {
  clearTimeout(retry);
  es?.close();
  const { id, sessionId } = getState().session;
  streamChat = id;
  streamSession = sessionId;
  const q = new URLSearchParams({ cid });
  if (id) q.set('chat', id);
  if (sessionId) q.set('session', sessionId);
  if (lastId) q.set('last', lastId);
  const src = new EventSource(apiUrl(`/api/events?${q}`));
  es = src;
  heard = Date.now();
  src.addEventListener('ping', () => (heard = Date.now()));
  src.onopen = () => {
    attempt = 0;
    setUi({ connected: true, restarting: false });
    loadSeen();
    avlog('stream open');
  };
  src.onerror = () => {
    if (es !== src) return;
    setUi({ connected: false });
    avlog('stream closed');
    // The browser retries the URL it was given; after a chat switch, or a new session in this chat, it asks for the wrong one, so reopen by hand.
    const now = getState().session;
    if (streamChat !== now.id || streamSession !== now.sessionId) src.close();
    if (src.readyState !== EventSource.CLOSED || !canRetry()) return;
    retry = setTimeout(() => canRetry() && connect(), backoffDelay(attempt));
    attempt++;
  };
  src.onmessage = (e) => {
    heard = Date.now();
    lastId = e.lastEventId || lastId;
    try {
      handle(JSON.parse(e.data));
    } catch (err) {
      avlog(`bad message ${String(err)}`);
    }
  };
}

const canRetry = () => navigator.onLine && document.visibilityState === 'visible';

export function retryNow() {
  attempt = 0;
  connect();
}

// A different Mac has its own chats and event ids, so the view starts over and the stream reopens.
export function switchedMac() {
  lastId = '';
  view.boot = 0;
  cache.clear();
  view.shownId = '';
  view.settled = false;
  set((s) => ({ session: { ...s.session, id: '', sessionId: null }, events: [], pending: [], live: [], findings: {}, seen: {}, ui: { ...s.ui, connected: false, openFile: null, openLine: null, beside: null } }));
  connect();
}

// Seconds since the stream last delivered anything, for the composer's stale notice.
export const sinceHeard = () => Math.round((Date.now() - heard) / 1000);

if (typeof document !== 'undefined') {
  setInterval(() => {
    if (document.visibilityState === 'visible' && es && Date.now() - heard > SILENT_MS) {
      avlog('stream silent, reconnecting');
      connect();
    }
  }, 10_000);
  let park: ReturnType<typeof setTimeout> | undefined;
  document.addEventListener('visibilitychange', () => {
    clearTimeout(park);
    if (document.visibilityState !== 'visible') {
      hiddenAt = Date.now();
      // The phone app closes the stream in the background so pings and chat events stop waking it; it resumes from lastId.
      if (bundled) park = setTimeout(() => { clearTimeout(retry); es?.close(); es = null; }, 10_000);
      return;
    }
    attempt = 0;
    // Android drops the connection in the background while the WebView still reports it open.
    if (!es || !getState().ui.connected || (hiddenAt && Date.now() - hiddenAt > 10_000)) connect();
  });
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      if (getState().ui.connected) return;
      attempt = 0;
      connect();
    });
  }
}
