import { useSyncExternalStore } from 'react';
import type { ClientMessage, ServerMessage, ServerState } from '../../shared/protocol';

type UiState = {
  connected: boolean;
  openFile: string | null;
  follow: boolean;
  switcherOpen: boolean;
};

export type State = ServerState & { ui: UiState };

let state: State = {
  session: { sessionId: null, model: null, cwd: '', running: false, permissionMode: null, apiKeySource: null, models: [], commands: [] },
  status: 'Connecting',
  events: [],
  pending: [],
  recentFiles: [],
  ui: { connected: false, openFile: null, follow: true, switcherOpen: false },
};

const listeners = new Set<() => void>();
function set(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  for (const l of listeners) l();
}

listeners.add(() => {
  const n = state.pending.length;
  const title = n > 0 ? `(${n}) AgentView` : 'AgentView';
  if (document.title !== title) document.title = title;
});

function notify(title: string, body: string) {
  if (document.visibilityState === 'visible') return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body });
  } catch {}
}

export function setUi(patch: Partial<UiState>) {
  set((s) => ({ ui: { ...s.ui, ...patch } }));
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => selector(state),
  );
}

let ws: WebSocket | null = null;
export function send(m: ClientMessage) {
  ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));
}

function handle(m: ServerMessage) {
  switch (m.type) {
    case 'init':
      set((s) => ({ ...m.state, ui: s.session.cwd && s.session.cwd !== m.state.session.cwd ? { ...s.ui, openFile: null } : s.ui }));
      break;
    case 'error':
      set((s) => ({ events: [...s.events, { id: crypto.randomUUID(), kind: 'system', text: m.text, at: Date.now() }] }));
      break;
    case 'event':
      if (m.event.kind === 'result' && !state.events.some((e) => e.id === m.event.id)) {
        notify('Claude finished', m.event.text.trim().split('\n')[0]);
      }
      set((s) => {
        const i = s.events.findIndex((e) => e.id === m.event.id);
        const events = i >= 0 ? s.events.map((e, j) => (j === i ? m.event : e)) : [...s.events, m.event];
        return { events };
      });
      break;
    case 'status':
      set({ status: m.text });
      break;
    case 'pending':
      if (!state.pending.some((p) => p.id === m.request.id)) {
        notify('Claude needs you', m.request.kind === 'question' ? m.request.questions[0]?.question ?? '' : m.request.title);
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
  }
}

export function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => setUi({ connected: true });
  ws.onclose = () => {
    setUi({ connected: false });
    setTimeout(connect, 1500);
  };
  ws.onmessage = (e) => handle(JSON.parse(e.data));
}
