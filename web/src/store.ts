import { useSyncExternalStore } from 'react';
import { ATTENTION_LABEL, type AttentionItem, type ChatEvent, type ClientMessage, type LiveChat, type ReviewFindings, type ServerMessage, type ServerState } from '../../shared/protocol';
import { notify } from './notify';

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

export type State = ServerState & { live: LiveChat[]; attention: AttentionItem[]; findings: Record<string, ReviewFindings>; ui: UiState };

let state: State = {
  session: { id: '', sessionId: null, model: null, effort: null, team: false, cwd: '', running: false, permissionMode: null, apiKeySource: null, models: [], commands: [], cache: null, context: null, compacting: false, stopping: false, mcp: [], loop: { on: false, max: 3, round: 0, phase: null }, repeat: null, pr: null },
  status: 'Connecting',
  events: [],
  pending: [],
  recentFiles: [],
  live: [],
  attention: [],
  findings: {},
  ui: { connected: false, openFile: null, follow: true, switcherOpen: false, repoPicker: false, beside: storedBeside() },
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

// crypto.randomUUID only exists on secure origins; the phone and other Macs load over plain http.
const uid = () => crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

export function notice(text: string) {
  set((s) => ({ events: [...s.events, { id: uid(), kind: 'system', text, at: Date.now() }] }));
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

export const api = (path: string) => `${path}${path.includes('?') ? '&' : '?'}chat=${encodeURIComponent(state.session.id)}`;

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

let boot = 0;
// Identifies this tab's event stream so a command lands on the chat this tab views.
const cid = uid();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A command is one POST; a network failure retries and returns false, a server error shows up as a notice and returns null.
async function post(m: ClientMessage, tries = 1): Promise<boolean | null> {
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
  void post(m, 2).then((ok) => ok === false && notice('Not connected, that did not reach the server'));
  return true;
}

// Messages carry an id so a retry after a lost reply does not run twice; the server ignores repeats.
// A lost message goes back in the box only if its chat is still shown, so it never lands in another chat's draft.
function deliver(msg: { type: 'prompt' | 'steer'; text: string; id: string }, onLost: () => void) {
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

function handle(m: ServerMessage) {
  switch (m.type) {
    case 'init':
      // A new server boot means new code on the dev server too; reload so the client matches it.
      if (m.boot && boot && m.boot !== boot) return location.reload();
      if (m.boot) boot = m.boot;
      set((s) => {
        const same = s.session.id === m.state.session.id;
        const old = new Map(s.events.map((e) => [e.id, e]));
        const events = m.state.events.map((e) => {
          const o = same ? old.get(e.id) : undefined;
          return o && JSON.stringify(o) === JSON.stringify(e) ? o : e;
        });
        const keep = same && events.length === s.events.length && events.every((e, i) => e === s.events[i]);
        const moved = Boolean(s.session.cwd) && s.session.cwd !== m.state.session.cwd;
        return { ...m.state, events: keep ? s.events : events, findings: moved ? {} : s.findings, ui: { ...s.ui, restarting: false, ...(moved && { openFile: null, openLine: null }) } };
      });
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

let es: EventSource | null = null;
let streamChat = '';
let lastId = '';
let retry: ReturnType<typeof setTimeout> | undefined;
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
  const q = new URLSearchParams({ cid });
  if (id) q.set('chat', id);
  if (sessionId) q.set('session', sessionId);
  if (lastId) q.set('last', lastId);
  const src = new EventSource(`/api/events?${q}`);
  es = src;
  heard = Date.now();
  src.addEventListener('ping', () => (heard = Date.now()));
  src.onopen = () => {
    setUi({ connected: true, restarting: false });
    avlog('stream open');
  };
  src.onerror = () => {
    if (es !== src) return;
    setUi({ connected: false });
    avlog('stream closed');
    // The browser retries the URL it was given; after a chat switch that is the wrong chat, so reopen by hand.
    if (streamChat !== getState().session.id) src.close();
    if (src.readyState === EventSource.CLOSED) retry = setTimeout(connect, 2_000);
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

// Seconds since the stream last delivered anything, for the composer's stale notice.
export const sinceHeard = () => Math.round((Date.now() - heard) / 1000);

if (typeof document !== 'undefined') {
  setInterval(() => {
    if (document.visibilityState === 'visible' && es && Date.now() - heard > SILENT_MS) {
      avlog('stream silent, reconnecting');
      connect();
    }
  }, 10_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return void (hiddenAt = Date.now());
    // Android drops the connection in the background while the WebView still reports it open.
    if (hiddenAt && Date.now() - hiddenAt > 10_000) connect();
  });
}
