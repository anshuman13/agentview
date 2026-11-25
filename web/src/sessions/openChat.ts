import { getState, send } from '../app/store';
import type { ChatRun } from '../../../shared/protocol';
import { stoppedText } from './runLogic';
import { showSnack } from '../codex/view';

let looking = 0;
export const turnPending = () => looking > 0;

// A prompt is in the transcript; it may take a moment to show after the chat opens.
// Returns a function that stops the retries.
export function showTurn(id: string, onFound?: (el: HTMLElement) => void) {
  let timer: ReturnType<typeof setTimeout>;
  let waiting = true;
  const settle = () => { if (waiting) { waiting = false; looking--; } };
  looking++;
  const look = (tries: number) => {
    const el = document.getElementById(`turn-${id}`);
    if (el) { onFound?.(el); el.scrollIntoView({ block: 'center' }); settle(); }
    else if (tries) timer = setTimeout(() => look(tries - 1), 100);
    else settle();
  };
  look(20);
  return () => { clearTimeout(timer); settle(); };
}

export function openChat(ids: { chatId?: string | null; sessionId?: string | null }) {
  const { live } = getState();
  const chat = live.find((c) => c.id === ids.chatId) ?? live.find((c) => c.sessionId === ids.sessionId);
  if (chat) send({ type: 'view', id: chat.id });
  else if (ids.sessionId) send({ type: 'open_session', sessionId: ids.sessionId });
}

export function showChat(ids: { chatId?: string | null; sessionId?: string | null }) {
  openChat(ids);
  window.dispatchEvent(new Event('agentview:chat'));
}

// Stops a run (Android Hub.runControl).
export function stopRun(run: ChatRun) {
  send({ type: 'run', run: run.id, op: 'stop' });
  showSnack(stoppedText(run));
}
