import { appendTo, ATTENTION_LABEL, type LiveChat, type ServerMessage } from '../../../../shared/protocol';
import { notify } from '../runtime/notify';
import { isMuted } from '../runtime/mute';
import { initPage } from '../runtime/pageEvents';
import { embedded, getState, notice, set, setFindings, setUi } from './core';
import { markSeen } from './seen';
import { send } from './send';
import { cache, cacheShown, view } from './view';

const repo = (c: LiveChat) => c.cwd.split('/').pop();
const focus = (id: string) => () => send({ type: 'view', id });

function notifyBackground(chats: LiveChat[]) {
  if (embedded) return;
  const { live, session } = getState();
  for (const c of chats) {
    const was = live.find((x) => x.id === c.id);
    if (!was || c.id === session.id) continue;
    if (c.pending > was.pending) notify(`Claude needs you in ${repo(c)}`, c.title, focus(c.id));
    else if (was.running && !c.running && !isMuted(c.sessionId)) notify(`Claude finished in ${repo(c)}`, c.title, focus(c.id));
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

function onInit(m: Extract<ServerMessage, { type: 'init' }>) {
  // A new server boot means new code on the dev server too; reload so the client matches it.
  if (m.boot && view.boot && m.boot !== view.boot) return location.reload();
  if (m.boot) view.boot = m.boot;
  // A chat opened another way (a saved chat, a new one) still leaves the one before it cached.
  if (view.shownId !== m.state.session.id) cacheShown();
  set((s) => {
    const same = s.session.id === m.state.session.id;
    const shown = view.shownId === m.state.session.id;
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
  view.shownId = m.state.session.id;
  view.settled = true;
}

function onEvent(m: Extract<ServerMessage, { type: 'event' }>) {
  const { events, session } = getState();
  if (m.event.kind === 'result' && !events.some((e) => e.id === m.event.id)) {
    notify('Claude finished', m.event.text.trim().split('\n')[0], focus(session.id));
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
    notify('Claude needs you', m.request.kind === 'question' ? m.request.questions[0]?.question ?? '' : m.request.title, focus(session.id));
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

export function handle(m: ServerMessage) {
  switch (m.type) {
    case 'init': return onInit(m);
    case 'findings': return setFindings(m.review);
    case 'error': return notice(m.text);
    case 'restarting': return setUi({ restarting: true });
    case 'event': return onEvent(m);
    case 'append': return onAppend(m);
    case 'status': return set({ status: m.text });
    case 'pending': return onPending(m);
    case 'resolved': return set((s) => ({ pending: s.pending.filter((p) => p.id !== m.id) }));
    case 'file_changed': return onFileChanged(m);
    case 'session': return set({ session: m.session });
    case 'live': return onLive(m);
    case 'runs': return set({ runs: m.runs });
    case 'attention': return onAttention(m);
  }
}
