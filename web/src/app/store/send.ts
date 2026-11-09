import { type ClientMessage } from '../../../../shared/protocol';
import { apiUrl } from '../api';
import { cid, getState, notice, set, uid } from './core';
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

// Messages carry an id so a retry after a lost reply does not run twice; the server ignores repeats.
// A lost message goes back in the box only if its chat is still shown, so it never lands in another chat's draft.
function deliver(msg: { type: 'prompt' | 'steer' | 'queue'; text: string; id: string }, onLost: () => void) {
  const chat = getState().session.id;
  void post(msg, 2).then((ok) => {
    if (ok) return;
    if (msg.type === 'steer') set((s) => ({ events: s.events.filter((e) => e.id !== msg.id) }));
    if (getState().session.id !== chat) return notice('A message to another chat may not have reached the server');
    notice('Message may not have reached the server. It is back in the composer.');
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
