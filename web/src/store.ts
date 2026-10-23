import { useSyncExternalStore } from 'react';
import type { ClientMessage, LiveChat, ReliableMessage, ServerState, Target, WireMessage } from '../../shared/protocol';
import { notify } from './notify';
import { Outbox, type OutboxEntry } from './outbox';
import { touch } from './touch';

type UiState = {
  connected: boolean;
  restarting?: boolean;
  openFile: string | null;
  follow: boolean;
  switcherOpen: boolean;
  repoPicker: boolean;
};

export type State = ServerState & { live: LiveChat[]; ui: UiState; outbox: OutboxEntry[] };

let state: State = {
  session: { id: '', sessionId: null, model: null, team: false, cwd: '', running: false, permissionMode: null, apiKeySource: null, models: [], commands: [], cache: null, context: null, compacting: false, stopping: false, mcp: [], loop: { on: false, max: 3, round: 0, phase: null } },
  status: 'Connecting',
  events: [],
  pending: [],
  recentFiles: [],
  live: [],
  ui: { connected: false, openFile: null, follow: true, switcherOpen: false, repoPicker: false },
  outbox: [],
};

const listeners = new Set<() => void>();
function set(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  for (const l of listeners) l();
}

listeners.add(() => {
  const n = state.live.reduce((sum, c) => sum + (c.id === state.session.id ? state.pending.length : c.pending), 0);
  const title = n > 0 ? `(${n}) AgentView` : 'AgentView';
  if (document.title !== title) document.title = title;
});

export function notice(text: string) {
  set((s) => ({ events: [...s.events, { id: crypto.randomUUID(), kind: 'system', text, at: Date.now() }] }));
}

export function setUi(patch: Partial<UiState>) {
  set((s) => ({ ui: { ...s.ui, ...patch } }));
}

export const getState = () => state;

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => selector(state),
  );
}

export const api = (path: string) => `${path}${path.includes('?') ? '&' : '?'}chat=${encodeURIComponent(state.session.id)}`;

const repo = (c: LiveChat) => c.cwd.split('/').pop();
const focus = (id: string) => () => send({ type: 'view', id });

function notifyBackground(chats: LiveChat[]) {
  for (const c of chats) {
    const was = state.live.find((x) => x.id === c.id);
    if (!was || c.id === state.session.id) continue;
    if (c.pending > was.pending) notify(`Claude needs you in ${repo(c)}`, c.title, focus(c.id));
    else if (was.running && !c.running) notify(`Claude finished in ${repo(c)}`, c.title, focus(c.id));
  }
}

let ws: WebSocket | null = null;
let sockId = 0;

// Fire and forget: for messages that are harmless to lose, like view changes and pings.
export function send(m: ClientMessage) {
  if (ws?.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(m));
  return true;
}

const VIEW_KEY = 'agentview.view';
const savedView = (): Target | null => {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null');
    return v && typeof v.chat === 'string' ? { chat: v.chat, session: typeof v.session === 'string' ? v.session : null } : null;
  } catch {
    return null;
  }
};
function saveView() {
  const { id, sessionId } = state.session;
  if (!id) return;
  try { localStorage.setItem(VIEW_KEY, JSON.stringify({ chat: id, session: sessionId })); } catch {}
}
const currentTarget = (): Target => (state.session.id ? { chat: state.session.id, session: state.session.sessionId } : savedView() ?? { chat: '', session: null });

const outbox = new Outbox(
  {
    get: () => {
      try { return localStorage.getItem('agentview.outbox'); } catch { return null; }
    },
    set: (v) => localStorage.setItem('agentview.outbox', v),
  },
  (m) => send(m as ClientMessage),
  currentTarget,
  () => set({ outbox: outbox.entries }),
);
state = { ...state, outbox: outbox.entries };

// Messages that must reach Claude: saved first, then retried until the server acks them.
export const deliver = (m: ReliableMessage) => outbox.enqueue(m, currentTarget());
export const prompt = (text: string) => deliver({ type: 'prompt', text });
export const steer = (text: string) => deliver({ type: 'steer', text });
export const retryMessage = (cid: string) => outbox.retry(cid);
export const discardMessage = (cid: string) => outbox.discard(cid);

// Where this client is in the current chat's message stream, so a reconnect asks only for what it missed.
let cursor: { chat: string; epoch: string; seq: number } | null = null;

function handle(m: WireMessage, sock: number) {
  if (m.type === 'init' && m.epoch) cursor = { chat: m.state.session.id, epoch: m.epoch, seq: m.seq ?? 0 };
  else if (m.type === 'resumed') cursor = { chat: state.session.id, epoch: m.epoch, seq: m.seq };
  else if (typeof m.seq === 'number') {
    if (!cursor || m.seq <= cursor.seq) return;
    if (m.seq !== cursor.seq + 1) {
      avlog('seq gap, reloading the chat');
      cursor = null;
      return reconnect();
    }
    cursor.seq = m.seq;
  }
  switch (m.type) {
    case 'ack':
      outbox.ack(m.cid, m.status, m.reason);
      break;
    case 'resumed':
      outbox.ready(sock);
      break;
    case 'init':
      set((s) => {
        const same = s.session.id === m.state.session.id;
        const old = new Map(s.events.map((e) => [e.id, e]));
        const events = m.state.events.map((e) => {
          const o = same ? old.get(e.id) : undefined;
          return o && JSON.stringify(o) === JSON.stringify(e) ? o : e;
        });
        const keep = same && events.length === s.events.length && events.every((e, i) => e === s.events[i]);
        return { ...m.state, events: keep ? s.events : events, ui: s.session.cwd && s.session.cwd !== m.state.session.cwd ? { ...s.ui, openFile: null } : s.ui };
      });
      saveView();
      if (m.epoch) outbox.ready(sock);
      else if (m.seq === undefined) outbox.sendOnce();
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
      saveView();
      break;
    case 'live':
      notifyBackground(m.chats);
      set({ live: m.chats });
      break;
  }
}

// Dev-only beacon logger installed by main.tsx.
const avlog = (ev: string) => (window as { avlog?: (e: string) => void }).avlog?.(ev);

let retry: ReturnType<typeof setTimeout> | undefined;
let attempt = 0;
let heard = 0;
let hiddenAt = 0;

// A socket still opening after this long is stuck (no network yet after a resume); start over. Slow links get longer.
const handshakeMs = () => 4000 + 2000 * Math.min(attempt, 3);
// The server ticks every 20 s, so this long without a message means the socket is dead.
const SILENT_MS = 45_000;
// Android cuts a backgrounded app's sockets after about 5 s, so after a longer hide the socket is assumed dead.
const AWAY_MS = 4000;

export function connect() {
  clearTimeout(retry);
  retry = undefined;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const to = currentTarget();
  const q = new URLSearchParams();
  if (to.chat) q.set('chat', to.chat);
  if (to.session) q.set('session', to.session);
  if (cursor && cursor.chat === to.chat) q.set('since', `${cursor.epoch}:${cursor.seq}`);
  const query = q.toString();
  const sock = new WebSocket(`${proto}://${location.host}/ws${query ? `?${query}` : ''}`);
  const id = ++sockId;
  ws = sock;
  heard = Date.now();
  outbox.lost();
  const opening = setTimeout(() => {
    if (ws !== sock || sock.readyState !== WebSocket.CONNECTING) return;
    avlog('ws handshake timeout');
    drop();
    schedule();
  }, handshakeMs());
  sock.onopen = () => {
    clearTimeout(opening);
    if (ws !== sock) return;
    attempt = 0;
    setUi({ connected: true, restarting: false });
    avlog('ws open');
  };
  sock.onclose = () => {
    clearTimeout(opening);
    if (ws !== sock) return;
    avlog('ws closed');
    ws = null;
    outbox.lost();
    setUi({ connected: false });
    schedule();
  };
  sock.onmessage = (e) => {
    if (ws !== sock) return;
    heard = Date.now();
    handle(JSON.parse(e.data), id);
  };
}

function drop() {
  const old = ws;
  ws = null;
  outbox.lost();
  setUi({ connected: false });
  old?.close();
}

function reconnect() {
  avlog('ws stale, reconnecting');
  drop();
  connect();
}

export const reconnectNow = () => reconnect();

// Retries back off while the app is in front. In the background they slow down: a phone has no network then and
// the resume handlers connect at once, while a desktop tab still wants its notifications.
function schedule() {
  if (retry || ws) return;
  const hidden = document.visibilityState === 'hidden';
  if (hidden && touch()) return;
  const wait = hidden ? 30_000 : Math.min(5000, 500 * 2 ** attempt++) * (0.5 + Math.random() / 2);
  retry = setTimeout(() => {
    retry = undefined;
    if (!ws) connect();
  }, wait);
}

function probe(wait: number) {
  if (ws?.readyState !== WebSocket.OPEN) return;
  const sent = Date.now();
  send({ type: 'ping' });
  setTimeout(() => heard < sent && ws?.readyState === WebSocket.OPEN && reconnect(), wait);
}

function wake() {
  if (document.visibilityState !== 'visible') return;
  const away = hiddenAt ? Date.now() - hiddenAt : 0;
  hiddenAt = 0;
  if (!ws) {
    attempt = 0;
    return connect();
  }
  if (ws.readyState === WebSocket.CONNECTING) return;
  if (away > AWAY_MS && touch()) return reconnect();
  probe(4000);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => (document.visibilityState === 'hidden' ? (hiddenAt ||= Date.now()) : wake()));
  addEventListener('pageshow', wake);
  addEventListener('focus', wake);
  addEventListener('online', () => (ws ? reconnect() : wake()));
  setInterval(() => {
    if (!ws) return schedule();
    if (document.visibilityState !== 'visible') return;
    else if (ws.readyState === WebSocket.OPEN && Date.now() - heard > SILENT_MS) reconnect();
  }, 5000);
}
