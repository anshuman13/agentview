import { useSyncExternalStore } from 'react';
import { appendTo, ATTENTION_LABEL, ROW_WINDOW, type AttentionItem, type ChatEvent, type ClientMessage, type LiveChat, type ReviewFindings, type ServerMessage, type ServerState } from '../../../shared/protocol';
import { notify } from './notify';
import { apiUrl, bundled } from './api';
import { backoffDelay } from './backoff';
import { initPage } from './pageEvents';

type UiState = {
  connected: boolean;
  restarting?: boolean;
  openFile: string | null;
  openLine?: number | null;
  follow: boolean;
  switcherOpen: boolean;
  repoPicker: boolean;
  beside: string | null;
};

// A side chat column is this app in an iframe; it shows one chat and nothing else.
export const embedded = typeof window !== 'undefined' && window.self !== window.top;
const storedBeside = () => { try { return embedded ? null : localStorage.getItem('agentview.beside') || null; } catch { return null; } };

export type State = ServerState & { live: LiveChat[]; attention: AttentionItem[]; findings: Record<string, ReviewFindings>; seen: Record<string, number>; ui: UiState };

let state: State = {
  session: { id: '', sessionId: null, model: null, effort: null, team: false, cwd: '', running: false, permissionMode: null, apiKeySource: null, models: [], commands: [], cache: null, context: null, compacting: false, stopping: false, mcp: [], loop: { on: false, max: 3, round: 0, phase: null }, repeat: null, pr: null, account: 'main', accounts: [] },
  status: 'Connecting',
  events: [],
  pending: [],
  recentFiles: [],
  live: [],
  attention: [],
  findings: {},
  seen: {},
  ui: { connected: false, openFile: null, follow: false, switcherOpen: false, repoPicker: false, beside: storedBeside() },
};

const listeners = new Set<() => void>();
// A hidden page renders nothing: streamed text would re-render the chat every 80 ms on a phone in a pocket.
let stale = false;
function set(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  setTitle();
  if (document.hidden) stale = true;
  else for (const l of listeners) l();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !stale) return;
    stale = false;
    for (const l of listeners) l();
  });
}

function setTitle() {
  const n = state.live.reduce((sum, c) => sum + (c.id === state.session.id ? state.pending.length : c.pending), 0);
  const title = n > 0 ? `(${n}) AgentView` : 'AgentView';
  if (document.title !== title) document.title = title;
}

// crypto.randomUUID only exists on secure origins; the phone and other Macs load over plain http.
const uid = () => crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

export function notice(text: string) {
  set((s) => ({ events: [...s.events, { id: uid(), kind: 'system', text, at: Date.now() }] }));
}

// One page of events before the oldest held one; false when it did not arrive, with a notice unless the chat or server changed meanwhile.
export async function loadEarlier() {
  const chat = state.session.id;
  const was = boot;
  const first = state.events[0]?.id;
  if (!first) return false;
  const stale = () => state.session.id !== chat || boot !== was || Boolean(state.ui.restarting);
  try {
    const r = await fetch(api(`/api/chat/events?before=${encodeURIComponent(first)}&limit=${ROW_WINDOW}`));
    const body = await r.json();
    if (stale()) return false;
    if (!r.ok) throw new Error(body.error ?? `${r.status} ${r.statusText}`);
    set((s) => ({ events: [...body.events, ...s.events], earlier: body.earlier }));
    return true;
  } catch (err) {
    if (!stale()) notice(`Could not load earlier messages: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

// A different Mac has its own chats and event ids, so the view starts over and the stream reopens.
export function switchedMac() {
  lastId = '';
  boot = 0;
  cache.clear();
  shownId = '';
  settled = false;
  set((s) => ({ session: { ...s.session, id: '', sessionId: null }, events: [], pending: [], live: [], findings: {}, seen: {}, ui: { ...s.ui, connected: false, openFile: null, openLine: null, beside: null } }));
  connect();
}

export function setUi(patch: Partial<UiState>) {
  set((s) => ({ ui: { ...s.ui, ...patch } }));
}

export const getState = () => state;

export function setFindings(review: ReviewFindings | null) {
  if (review) set((s) => ({ findings: { ...s.findings, [review.target]: review } }));
}

// Chat to ask for on the first connect, from a deep link.
export function presetChat(chat: string | null, sessionId: string | null) {
  set((s) => ({ session: { ...s.session, id: chat ?? s.session.id, sessionId: sessionId ?? s.session.sessionId } }));
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => selector(state),
  );
}

export const api = (path: string) => apiUrl(`${path}${path.includes('?') ? '&' : '?'}chat=${encodeURIComponent(state.session.id)}`);

const repo = (c: LiveChat) => c.cwd.split('/').pop();
const focus = (id: string) => () => send({ type: 'view', id });

function notifyBackground(chats: LiveChat[]) {
  if (embedded) return;
  for (const c of chats) {
    const was = state.live.find((x) => x.id === c.id);
    if (!was || c.id === state.session.id) continue;
    if (c.pending > was.pending) notify(`Claude needs you in ${repo(c)}`, c.title, focus(c.id));
    else if (was.running && !c.running) notify(`Claude finished in ${repo(c)}`, c.title, focus(c.id));
  }
}

const SEEN_URL = '/api/sessions/seen';

// Seen times live on the Mac, so every device clears the same unread marks.
export function loadSeen() {
  fetch(apiUrl(SEEN_URL)).then((r) => r.json()).then((seen) => seen && typeof seen === 'object' && !Array.isArray(seen) && set({ seen })).catch(() => {});
}

// The stream connect reloads the server's times over this local one.
function markSeen(sessionId: string | null | undefined) {
  if (!sessionId) return;
  set((s) => ({ seen: { ...s.seen, [sessionId]: Date.now() } }));
  fetch(apiUrl(`${SEEN_URL}?id=${encodeURIComponent(sessionId)}`), { method: 'POST' }).catch(() => {});
}

// The last rows of the most recently viewed chats, so switching back shows them before the server's init arrives.
const CACHED_CHATS = 8;
const cache = new Map<string, { events: ChatEvent[]; earlier: number }>();
// The chat the rows in `events` belong to, and whether its init has arrived; session.id still names the old chat after a cache hit.
let shownId = '';
let settled = false;

function cacheShown() {
  const { events, earlier } = state;
  if (!shownId || !settled || !events.length) return;
  const kept = events.slice(-ROW_WINDOW);
  cache.delete(shownId);
  cache.set(shownId, { events: kept, earlier: (earlier ?? 0) + events.length - kept.length });
  if (cache.size > CACHED_CHATS) cache.delete(cache.keys().next().value!);
}

function showCached(id: string) {
  if (id === shownId) return;
  const hit = cache.get(id);
  cacheShown();
  if (!hit) return;
  shownId = id;
  settled = false;
  set({ events: hit.events, earlier: hit.earlier });
}

function markViewedDone(chats: LiveChat[]) {
  for (const c of chats) if (c.id === state.session.id && state.live.find((x) => x.id === c.id)?.running && !c.running) markSeen(c.sessionId);
}

let boot = 0;
// Identifies this tab's event stream so a command lands on the chat this tab views.
const cid = uid();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A command is one POST; a network failure retries and returns false, a server error shows up as a notice and returns null.
async function post(m: ClientMessage, tries = 1): Promise<boolean | null> {
  // Built once: the chat in it is the target, so a retry after a chat switch still lands in the chat it was made for.
  const url = api(`/api/cmd?cid=${cid}`);
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(m), signal: AbortSignal.timeout(10_000) });
      if (r.ok) return true;
      // The server has no stream for this tab; reopen it and try again.
      if (r.status === 409 && i + 1 < tries) {
        connect();
        await sleep(2_000);
        continue;
      }
      const body = await r.json().catch(() => ({}));
      notice(body.error ?? `${r.status} ${r.statusText}`);
      return null;
    } catch {
      if (i + 1 < tries) await sleep(2_000 * (i + 1));
    }
  }
  return false;
}

export function send(m: ClientMessage) {
  if (m.type === 'view') showCached(m.id);
  if (m.type === 'open_session') markSeen(m.sessionId);
  else if (m.type === 'view') markSeen(state.live.find((c) => c.id === m.id)?.sessionId);
  void post(m, 2).then((ok) => ok === false && notice('Not connected, that did not reach the server'));
  return true;
}

// Messages carry an id so a retry after a lost reply does not run twice; the server ignores repeats.
// A lost message goes back in the box only if its chat is still shown, so it never lands in another chat's draft.
function deliver(msg: { type: 'prompt' | 'steer' | 'queue'; text: string; id: string }, onLost: () => void) {
  const chat = state.session.id;
  void post(msg, 2).then((ok) => {
    if (ok) return;
    if (msg.type === 'steer') set((s) => ({ events: s.events.filter((e) => e.id !== msg.id) }));
    if (state.session.id !== chat) return notice('A message to another chat may not have reached the server');
    notice('Message may not have reached the server, it is back in the box');
    onLost();
  });
}

export function steer(text: string, onLost: () => void) {
  const id = uid();
  set((s) => ({ events: [...s.events, { id, kind: 'user', text, at: Date.now(), stopping: true }] }));
  deliver({ type: 'steer', text, id }, onLost);
}

export function prompt(text: string, onLost: () => void) {
  deliver({ type: 'prompt', text, id: uid() }, onLost);
}

// While Claude works, the message reaches it at its next step without stopping it.
export function queueNext(text: string, onLost: () => void) {
  deliver({ type: 'queue', text, id: uid() }, onLost);
}

// Structural compare for JSON values; about 5x faster than comparing two JSON.stringify results.
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => equal((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

// The first attention list after load is not news; later ones notify per new item.
let attentionSeen = false;

function handle(m: ServerMessage) {
  switch (m.type) {
    case 'init':
      // A new server boot means new code on the dev server too; reload so the client matches it.
      if (m.boot && boot && m.boot !== boot) return location.reload();
      if (m.boot) boot = m.boot;
      set((s) => {
        const same = s.session.id === m.state.session.id;
        const shown = shownId === m.state.session.id;
        const old = new Map(s.events.map((e) => [e.id, e]));
        const page = initPage(s.events, same, m.state.events, m.state.earlier);
        const events = page.events.map((e) => {
          const o = shown ? old.get(e.id) : undefined;
          return o && equal(o, e) ? o : e;
        });
        const keep = shown && events.length === s.events.length && events.every((e, i) => e === s.events[i]);
        const moved = Boolean(s.session.cwd) && s.session.cwd !== m.state.session.cwd;
        return { ...m.state, earlier: page.earlier, events: keep ? s.events : events, findings: moved ? {} : s.findings, ui: { ...s.ui, restarting: false, ...(moved && { openFile: null, openLine: null }) } };
      });
      shownId = m.state.session.id;
      settled = true;
      break;
    case 'findings':
      setFindings(m.review);
      break;
    case 'error':
      notice(m.text);
      break;
    case 'restarting':
      setUi({ restarting: true });
      break;
    case 'event':
      if (m.event.kind === 'result' && !state.events.some((e) => e.id === m.event.id)) {
        notify('Claude finished', m.event.text.trim().split('\n')[0], focus(state.session.id));
      }
      set((s) => {
        const cur = s.events;
        let i = cur.length - 1;
        while (i >= 0 && cur[i].id !== m.event.id) i--;
        if (i < 0) return { events: [...cur, m.event] };
        const events = cur.slice();
        events[i] = m.event;
        return { events };
      });
      break;
    case 'append': {
      let i = state.events.length - 1;
      while (i >= 0 && state.events[i].id !== m.id) i--;
      const ev = i < 0 ? null : appendTo(state.events[i], m.offset, m.text);
      if (!ev) break;
      const events = state.events.slice();
      events[i] = ev;
      set({ events });
      break;
    }
    case 'status':
      set({ status: m.text });
      break;
    case 'pending':
      if (!state.pending.some((p) => p.id === m.request.id)) {
        notify('Claude needs you', m.request.kind === 'question' ? m.request.questions[0]?.question ?? '' : m.request.title, focus(state.session.id));
        if (document.visibilityState !== 'visible') navigator.vibrate?.(200);
      }
      set((s) => ({ pending: [...s.pending.filter((p) => p.id !== m.request.id), m.request] }));
      break;
    case 'resolved':
      set((s) => ({ pending: s.pending.filter((p) => p.id !== m.id) }));
      break;
    case 'file_changed':
      set((s) => ({
        recentFiles: [m.path, ...s.recentFiles.filter((f) => f !== m.path)].slice(0, 30),
        ui: s.ui.follow && m.source === 'tool' ? { ...s.ui, openFile: m.path } : s.ui,
      }));
      break;
    case 'session':
      set({ session: m.session });
      break;
    case 'live':
      notifyBackground(m.chats);
      markViewedDone(m.chats);
      for (const id of cache.keys()) if (!m.chats.some((c) => c.id === id)) cache.delete(id);
      set({ live: m.chats });
      break;
    case 'attention':
      for (const it of m.items) {
        if (attentionSeen && !state.attention.some((x) => x.id === it.id)) notify(`${ATTENTION_LABEL[it.kind]} in ${it.repo}`, `${it.number ? `#${it.number} ` : ''}${it.title}`, () => (it.chatId ? send({ type: 'view', id: it.chatId }) : window.open(it.url, '_blank')));
      }
      attentionSeen = true;
      set({ attention: m.items });
      break;
  }
}

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
