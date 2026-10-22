import { useSyncExternalStore } from 'react';
import type { ClientMessage, LiveChat, ServerMessage, ServerState } from '../../shared/protocol';
import { notify } from './notify';

type UiState = {
  connected: boolean;
  restarting?: boolean;
  openFile: string | null;
  follow: boolean;
  switcherOpen: boolean;
  repoPicker: boolean;
};

export type State = ServerState & { live: LiveChat[]; ui: UiState };

let state: State = {
  session: { id: '', sessionId: null, model: null, team: false, cwd: '', running: false, permissionMode: null, apiKeySource: null, models: [], commands: [], cache: null, context: null, compacting: false, stopping: false, mcp: [], loop: { on: false, max: 3, round: 0, phase: null } },
  status: 'Connecting',
  events: [],
  pending: [],
  recentFiles: [],
  live: [],
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
export function send(m: ClientMessage) {
  ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));
}

export function steer(text: string) {
  if (ws?.readyState !== WebSocket.OPEN) return notice('Not connected, message not sent');
  const id = crypto.randomUUID();
  set((s) => ({ events: [...s.events, { id, kind: 'user', text, at: Date.now(), stopping: true }] }));
  send({ type: 'steer', text, id });
}

function handle(m: ServerMessage) {
  switch (m.type) {
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
let heard = 0;

export function connect() {
  clearTimeout(retry);
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const { id, sessionId } = getState().session;
  const sock = new WebSocket(`${proto}://${location.host}/ws${id ? `?chat=${encodeURIComponent(id)}&session=${encodeURIComponent(sessionId ?? '')}` : ''}`);
  ws = sock;
  heard = Date.now();
  sock.onopen = () => {
    setUi({ connected: true, restarting: false });
    avlog('ws open');
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    avlog('ws closed');
    setUi({ connected: false });
    retry = setTimeout(connect, 1500);
  };
  sock.onmessage = (e) => {
    heard = Date.now();
    handle(JSON.parse(e.data));
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
  setTimeout(() => heard < sent && ws?.readyState === WebSocket.OPEN && reconnect(), wait);
}

if (typeof document !== 'undefined') {
  setInterval(() => document.visibilityState === 'visible' && probe(10000), 15000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && probe(8000));
}
