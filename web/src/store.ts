import { useSyncExternalStore } from 'react';
import { ATTENTION_LABEL, type AttentionItem, type ChatEvent, type ClientMessage, type LiveChat, type ServerMessage, type ServerState } from '../../shared/protocol';
import { notify } from './notify';

type UiState = {
  connected: boolean;
  restarting?: boolean;
  openFile: string | null;
  follow: boolean;
  switcherOpen: boolean;
  repoPicker: boolean;
};

export type State = ServerState & { live: LiveChat[]; attention: AttentionItem[]; ui: UiState };

let state: State = {
  session: { id: '', sessionId: null, model: null, team: false, cwd: '', running: false, permissionMode: null, apiKeySource: null, models: [], commands: [], cache: null, context: null, compacting: false, stopping: false, mcp: [], loop: { on: false, max: 3, round: 0, phase: null } },
  status: 'Connecting',
  events: [],
  pending: [],
  recentFiles: [],
  live: [],
  attention: [],
  ui: { connected: false, openFile: null, follow: true, switcherOpen: false, repoPicker: false },
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
// Taps made during a reconnect (Allow, answers, chat switches) wait for the next socket instead of vanishing.
const backlog: ClientMessage[] = [];
export function send(m: ClientMessage) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(m));
    return true;
  }
  if (m.type !== 'ping') backlog.push(m);
  if (backlog.length > 20) backlog.shift();
  if (ws?.readyState !== WebSocket.CONNECTING) reconnect();
  return false;
}

export function steer(text: string, onLost: () => void) {
  const id = crypto.randomUUID();
  set((s) => ({ events: [...s.events, { id, kind: 'user', text, at: Date.now(), stopping: true }] }));
  expect({ type: 'steer', text, id }, onLost);
}

export function prompt(text: string, onLost: () => void) {
  expect({ type: 'prompt', text, id: crypto.randomUUID() }, onLost);
}

// A message is sent until the server echoes it back as a user event. The server ignores repeats by id.
const CONFIRM_WAIT = 8_000;
const TRIES = 3;
type Expected = { msg: { type: 'prompt' | 'steer'; text: string; id: string }; onLost: () => void; tries: number };
const expected = new Set<Expected>();

function expect(msg: Expected['msg'], onLost: () => void) {
  const e: Expected = { msg, onLost, tries: 0 };
  expected.add(e);
  attempt(e);
}

function attempt(e: Expected) {
  e.tries++;
  send(e.msg);
  setTimeout(() => {
    if (!expected.has(e)) return;
    if (e.tries < TRIES) {
      reconnect();
      return attempt(e);
    }
    expected.delete(e);
    notice('Message did not reach the server, it is back in the box');
    e.onLost();
  }, CONFIRM_WAIT);
}

function confirm(ev: ChatEvent) {
  if (ev.kind !== 'user') return;
  for (const e of expected) if (e.msg.id === ev.id) expected.delete(e);
}

function handle(m: ServerMessage) {
  switch (m.type) {
    case 'init':
      m.state.events.forEach(confirm);
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
      break;
    case 'error':
      notice(m.text);
      break;
    case 'restarting':
      setUi({ restarting: true });
      break;
    case 'event':
      confirm(m.event);
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
      break;
    case 'live':
      notifyBackground(m.chats);
      set({ live: m.chats });
      break;
    case 'attention':
      for (const it of m.items) {
        if (state.attention.length && !state.attention.some((x) => x.id === it.id)) notify(`${ATTENTION_LABEL[it.kind]} in ${it.repo}`, `${it.number ? `#${it.number} ` : ''}${it.title}`, () => (it.chatId ? send({ type: 'view', id: it.chatId }) : window.open(it.url, '_blank')));
      }
      set({ attention: m.items });
      break;
  }
}

// Dev-only beacon logger installed by main.tsx.
const avlog = (ev: string) => (window as { avlog?: (e: string) => void }).avlog?.(ev);

let retry: ReturnType<typeof setTimeout> | undefined;
let heard = 0;
let openedAt = 0;
let hiddenAt = 0;
let delay = 1000;

export function connect() {
  clearTimeout(retry);
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const { id, sessionId } = getState().session;
  const sock = new WebSocket(`${proto}://${location.host}/ws${id ? `?chat=${encodeURIComponent(id)}&session=${encodeURIComponent(sessionId ?? '')}` : ''}`);
  ws = sock;
  heard = openedAt = Date.now();
  const handshake = setTimeout(() => sock.readyState === WebSocket.CONNECTING && sock.close(), 10_000);
  sock.onopen = () => {
    clearTimeout(handshake);
    delay = 1000;
    setUi({ connected: true, restarting: false });
    avlog('ws open');
    for (const m of backlog.splice(0)) sock.send(JSON.stringify(m));
  };
  sock.onclose = () => {
    clearTimeout(handshake);
    if (ws !== sock) return;
    avlog('ws closed');
    setUi({ connected: false });
    retry = setTimeout(connect, delay);
    delay = Math.min(delay * 2, 15000);
  };
  sock.onmessage = (e) => {
    heard = Date.now();
    try {
      handle(JSON.parse(e.data));
    } catch (err) {
      avlog(`bad message ${String(err)}`);
    }
  };
}

function reconnect() {
  avlog('ws stale, reconnecting');
  ws?.close();
  ws = null;
  connect();
}

function probe(wait: number) {
  if (ws?.readyState === WebSocket.CONNECTING) return;
  if (ws?.readyState !== WebSocket.OPEN) return reconnect();
  const sent = Date.now();
  send({ type: 'ping' });
  setTimeout(() => {
    if (heard >= sent || ws?.readyState !== WebSocket.OPEN) return;
    // A large init can take longer than the probe on a slow link; give a fresh socket a minute before calling it stale.
    if (heard > openedAt || Date.now() - openedAt > 60_000) reconnect();
  }, wait);
}

if (typeof document !== 'undefined') {
  setInterval(() => document.visibilityState === 'visible' && probe(10000), 15000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return void (hiddenAt = Date.now());
    // Android drops the socket about 5 s into background while the WebView still reports it open.
    if (hiddenAt && Date.now() - hiddenAt > 10_000) reconnect();
    else probe(8000);
  });
}
