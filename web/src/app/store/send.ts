import { type ClientMessage } from '../../../../shared/protocol';
import { apiUrl } from '../api';
import { cid, getState, notice, OUTBOX_KEY, set, uid } from './core';
import { addQueued, cancelQueued, flushQueue, queuedCommand, type Queued } from './outboxLogic';
import { markSeen } from './seen';
import { showCached } from './view';
import { connect } from './stream';
import { postCommand } from './storeApi';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A command is one POST; a network failure retries and returns false, a server error shows up as a notice and returns null.
async function post(m: ClientMessage, tries = 1, chat = getState().session.id): Promise<boolean | null> {
  // Built once: the chat in it is the target, so a retry after a chat switch still lands in the chat it was made for.
  const url = apiUrl(`/api/cmd?cid=${cid}&chat=${encodeURIComponent(chat)}`);
  for (let i = 0; i < tries; i++) {
    try {
      const r = await postCommand(url, m);
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

// A command for a chat other than the one on screen names it, since a view sent just before may not have landed yet.
export function send(m: ClientMessage, chat?: string) {
  if (m.type === 'view') showCached(m.id);
  if (m.type === 'open_session') markSeen(m.sessionId);
  else if (m.type === 'view') markSeen(getState().live.find((c) => c.id === m.id)?.sessionId);
  void post(m, 2, chat).then((ok) => ok === false && notice('Not connected. That did not reach the server.'));
  return true;
}

function setOutbox(outbox: Queued[]) {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox)); } catch {}
  set({ outbox });
}

export const cancelUnsent = (id: string) => setOutbox(cancelQueued(getState().outbox, id));

const isRunning = (chat: string) => {
  const { session, live } = getState();
  return (session.id === chat ? session.running : live.find((c) => c.id === chat)?.running) === true;
};

let flushing = false;
let retry: ReturnType<typeof setTimeout> | undefined;

// A refused message is dropped, back in the composer when its chat is shown; only a network failure keeps it queued.
async function flushOne(q: Queued) {
  const ok = await post(queuedCommand(q, isRunning(q.chat)), 1, q.chat);
  if (ok === null && q.chat === getState().session.id) window.dispatchEvent(new CustomEvent('agentview:insert', { detail: { text: q.text } }));
  return ok !== false;
}

// Sends the outbox oldest first with each message's own id, so one that arrived before a lost reply is ignored the second time.
export async function flushOutbox() {
  if (flushing) return;
  flushing = true;
  try {
    const all = await flushQueue(() => getState().outbox, flushOne, cancelUnsent);
    if (!all && getState().ui.connected && retry === undefined) retry = setTimeout(() => { retry = undefined; void flushOutbox(); }, 5_000);
  } finally {
    flushing = false;
  }
}

// Messages carry an id so a retry after a lost reply does not run twice; the server ignores repeats.
// A lost message goes back in the box only if its chat is still shown, so it never lands in another chat's draft.
function deliver(msg: { type: 'prompt' | 'steer' | 'queue'; text: string; id: string }, onLost: () => void) {
  const { session, ui, outbox } = getState();
  const chat = session.id;
  // While the stream is down, or older messages wait, the message joins the outbox so order holds.
  if (!ui.connected || outbox.length > 0) {
    const next = addQueued(outbox, { id: msg.id, chat, text: msg.text, steer: msg.type === 'steer', at: Date.now() });
    if (!next) {
      notice('Too many unsent messages');
      // After the caller has emptied the composer, so the text lands back in it.
      queueMicrotask(onLost);
    } else {
      setOutbox(next);
      if (ui.connected) void flushOutbox();
    }
    return;
  }
  if (msg.type === 'steer') set((s) => ({ events: [...s.events, { id: msg.id, kind: 'user', text: msg.text, at: Date.now(), stopping: true }] }));
  void post(msg, 2).then((ok) => {
    if (ok) return;
    if (msg.type === 'steer') set((s) => ({ events: s.events.filter((e) => e.id !== msg.id) }));
    if (getState().session.id !== chat) return notice('A message to another chat may not have reached the server');
    notice('Message may not have reached the server. It is back in the composer.');
    onLost();
  });
}

// A prompt for the open chat: queued while a turn runs, back in the composer if it is lost.
export function sendToChat(message: string) {
  const lost = () => window.dispatchEvent(new CustomEvent('agentview:insert', { detail: { text: message } }));
  if (getState().session.running) queueNext(message, lost);
  else prompt(message, lost);
}

export function steer(text: string, onLost: () => void) {
  deliver({ type: 'steer', text, id: uid() }, onLost);
}

export function prompt(text: string, onLost: () => void) {
  deliver({ type: 'prompt', text, id: uid() }, onLost);
}

// While Claude works, the message reaches it at its next step without stopping it.
export function queueNext(text: string, onLost: () => void) {
  deliver({ type: 'queue', text, id: uid() }, onLost);
}
