import { appendTo, ATTENTION_LABEL, type LiveChat, type ServerMessage } from '../../../../shared/protocol';
import { notify } from '../runtime/notify';
import { isMuted } from '../runtime/mute';
import { initPage } from '../runtime/pageEvents';
import { EMPTY_SESSION, embedded, getState, notice, set, setFindings, setUi } from './core';
import { bundled } from '../api';
import { markSeen } from './seen';
import { send } from './send';
import { cache, cacheShown, view } from './view';
import { providerLabel } from '../../../../shared/providers';
import { rememberModels } from '../newChat';

const repo = (c: LiveChat) => c.cwd.split('/').pop();
const focus = (id: string) => () => send({ type: 'view', id });

function notifyBackground(chats: LiveChat[]) {
  if (embedded) return;
  const { live, session } = getState();
  for (const c of chats) {
    const was = live.find((x) => x.id === c.id);
    if (!was || c.id === session.id) continue;
    if (c.pending > was.pending) notify(`${providerLabel(c.provider)} needs you in ${repo(c)}`, c.title, focus(c.id));
    else if (was.running && !c.running && !isMuted(c.sessionId)) notify(`${providerLabel(c.provider)} finished in ${repo(c)}`, c.title, focus(c.id));
  }
}

function markViewedDone(chats: LiveChat[]) {
  const { live, session } = getState();
  for (const c of chats) if (c.id === session.id && live.find((x) => x.id === c.id)?.running && !c.running) markSeen(c.sessionId);
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

const PROTOCOL_RELOAD = 'agentview.protocolReload';
const SKEW_PAGE = 'This page is from another AgentView version than this Mac. Reload once the Mac has finished updating.';
const SKEW_APP = 'This app and this Mac run different AgentView versions. Rebuild the app or update the Mac.';

// A storage that throws counts as already reloaded, so the page never reloads in a loop.
function reloadedFor() {
  try {
    return sessionStorage.getItem(PROTOCOL_RELOAD);
  } catch {
    return '';
  }
}

const protocolDiffers = (server: string | undefined) => Boolean(server) && !import.meta.env.DEV && typeof __PROTOCOL__ === 'string' && server !== __PROTOCOL__;

function onInit(m: Extract<ServerMessage, { type: 'init' }>) {
  // A new server boot means new code on the dev server too; reload so the client matches it.
  if (m.boot && view.boot && m.boot !== view.boot) return location.reload();
  // A server built from another protocol.ts can send state this code misreads. A page reloads once to get the server's build;
  // the desktop app bundles its UI, so there, and when the reload did not help, the chat and the crash screen say so.
  const differs = protocolDiffers(m.protocol);
  if (differs && !bundled && !embedded && reloadedFor() === null) {
    try {
      sessionStorage.setItem(PROTOCOL_RELOAD, m.protocol!);
    } catch {}
    return location.reload();
  }
  view.skew = differs ? (bundled ? SKEW_APP : SKEW_PAGE) : '';
  if (m.boot) view.boot = m.boot;
  // A chat opened another way (a saved chat, a new one) still leaves the one before it cached.
  if (view.shownId !== m.state.session.id) cacheShown();
  set((s) => {
    const same = s.session.id === m.state.session.id;
    const shown = view.shownId === m.state.session.id;
    const old = new Map(s.events.map((e) => [e.id, e]));
    const page = initPage(s.events, s.earlier ?? 0, same, m.state.events, m.state.earlier);
    const events = page.events.map((e) => {
      const o = shown ? old.get(e.id) : undefined;
      return o && equal(o, e) ? o : e;
    });
    const keep = shown && events.length === s.events.length && events.every((e, i) => e === s.events[i]);
    const moved = Boolean(s.session.cwd) && s.session.cwd !== m.state.session.cwd;
    return { ...m.state, session: { ...EMPTY_SESSION, ...m.state.session }, earlier: page.earlier, events: keep ? s.events : events, findings: moved ? {} : s.findings, ui: { ...s.ui, restarting: false, ...(moved && { openFile: null, openLine: null }) } };
  });
  view.shownId = m.state.session.id;
  view.settled = true;
  if (view.skew) notice(view.skew);
}

function onEvent(m: Extract<ServerMessage, { type: 'event' }>) {
  const { events, session } = getState();
  if (m.event.kind === 'result' && !events.some((e) => e.id === m.event.id)) {
    notify(`${providerLabel(session.provider)} finished`, m.event.text.trim().split('\n')[0], focus(session.id));
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
}

function onAppend(m: Extract<ServerMessage, { type: 'append' }>) {
  const cur = getState().events;
  let i = cur.length - 1;
  while (i >= 0 && cur[i].id !== m.id) i--;
  const ev = i < 0 ? null : appendTo(cur[i], m.offset, m.text);
  if (!ev) return;
  const events = cur.slice();
  events[i] = ev;
  set({ events });
}

function onPending(m: Extract<ServerMessage, { type: 'pending' }>) {
  const { pending, session } = getState();
  if (!pending.some((p) => p.id === m.request.id)) {
    notify(`${providerLabel(session.provider)} needs you`, m.request.kind === 'question' ? m.request.questions[0]?.question ?? '' : m.request.title, focus(session.id));
    if (document.visibilityState !== 'visible') navigator.vibrate?.(200);
  }
  set((s) => ({ pending: [...s.pending.filter((p) => p.id !== m.request.id), m.request] }));
}

function onFileChanged(m: Extract<ServerMessage, { type: 'file_changed' }>) {
  set((s) => ({
    recentFiles: [m.path, ...s.recentFiles.filter((f) => f !== m.path)].slice(0, 30),
    ui: s.ui.follow && m.source === 'tool' ? { ...s.ui, openFile: m.path } : s.ui,
  }));
}

function onLive(m: Extract<ServerMessage, { type: 'live' }>) {
  notifyBackground(m.chats);
  markViewedDone(m.chats);
  for (const id of cache.keys()) if (!m.chats.some((c) => c.id === id)) cache.delete(id);
  set({ live: m.chats });
}

function onAttention(m: Extract<ServerMessage, { type: 'attention' }>) {
  const known = getState().attention;
  for (const it of m.items) {
    if (attentionSeen && !known.some((x) => x.id === it.id)) notify(`${ATTENTION_LABEL[it.kind]} in ${it.repo}`, `${it.number ? `#${it.number} ` : ''}${it.title}`, () => (it.chatId ? send({ type: 'view', id: it.chatId }) : window.open(it.url, '_blank')));
  }
  attentionSeen = true;
  set({ attention: m.items });
}

// Model lists are kept per provider for the new chat and goal sheets, which open before any chat of that provider is on screen.
function keepModels() {
  const { session } = getState();
  rememberModels(session.provider, session.models);
}

export function handle(m: ServerMessage) {
  switch (m.type) {
    case 'init':
      onInit(m);
      return keepModels();
    case 'findings': return setFindings(m.review);
    case 'error': return notice(m.text);
    case 'restarting': return setUi({ restarting: true });
    case 'event': return onEvent(m);
    case 'append': return onAppend(m);
    case 'status': return set({ status: m.text });
    case 'pending': return onPending(m);
    case 'resolved': return set((s) => ({ pending: s.pending.filter((p) => p.id !== m.id) }));
    case 'file_changed': return onFileChanged(m);
    case 'session':
      set((s) => ({ session: { ...s.session, ...m.session } }));
      return keepModels();
    case 'live': return onLive(m);
    case 'runs': return set({ runs: m.runs });
    case 'attention': return onAttention(m);
  }
}
