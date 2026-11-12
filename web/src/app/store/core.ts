import { useSyncExternalStore } from 'react';
import { type AttentionItem, type ChatRun, type LiveChat, type ReviewFindings, type ServerState } from '../../../../shared/protocol';
import { apiUrl } from '../api';
import { track } from '../featureUse';

export type GoalSheetState = { mode: 'start'; plan?: string; here?: boolean } | { mode: 'detail'; run: string };

type UiState = {
  connected: boolean;
  restarting?: boolean;
  openFile: string | null;
  openLine?: number | null;
  openEdit?: boolean;
  follow: boolean;
  switcherOpen: boolean;
  repoPicker: boolean;
  beside: string | null;
  sketch: string | null;
  goalSheet?: GoalSheetState | null;
};

// A side chat column is this app in an iframe; it shows one chat and nothing else.
export const embedded = typeof window !== 'undefined' && window.self !== window.top;
const storedBeside = () => { try { return embedded ? null : localStorage.getItem('agentview.beside') || null; } catch { return null; } };

export type State = ServerState & { live: LiveChat[]; runs: ChatRun[]; attention: AttentionItem[]; findings: Record<string, ReviewFindings>; seen: Record<string, number>; ui: UiState };

let state: State = {
  session: { id: '', sessionId: null, model: null, effort: null, cwd: '', running: false, permissionMode: null, apiKeySource: null, models: [], commands: [], cache: null, context: null, compacting: false, stopping: false, mcp: [], loop: { on: false, max: 3, round: 0, phase: null }, repeat: null, pr: null, account: 'main', accounts: [] },
  status: 'Connecting',
  events: [],
  pending: [],
  recentFiles: [],
  live: [],
  runs: [],
  attention: [],
  findings: {},
  seen: {},
  ui: { connected: false, openFile: null, follow: false, switcherOpen: false, repoPicker: false, beside: storedBeside(), sketch: null },
};

const listeners = new Set<() => void>();
// A hidden page renders nothing: streamed text would re-render the chat every 80 ms on a phone in a pocket.
let stale = false;
export function set(patch: Partial<State> | ((s: State) => Partial<State>)) {
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
export const uid = () => crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

// Identifies this tab's event stream so a command lands on the chat this tab views.
export const cid = uid();

export function notice(text: string) {
  set((s) => ({ events: [...s.events, { id: uid(), kind: 'system', text, at: Date.now() }] }));
}

export function setUi(patch: Partial<UiState>) {
  if (patch.goalSheet) track('sheet:goal');
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

export const subscribe = (l: () => void) => (listeners.add(l), () => { listeners.delete(l); });

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
  );
}

export const api = (path: string) => apiUrl(`${path}${path.includes('?') ? '&' : '?'}chat=${encodeURIComponent(state.session.id)}`);
