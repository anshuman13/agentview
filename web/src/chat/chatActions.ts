import { embedded, getState, notice, prompt, send, setUi, subscribe } from '../app/store';
import { showChat } from '../ui/util';
import { createStore } from '../ui/createStore';
import { handoffText } from './composer/composerLogic';
import { copyText, showSnack } from '../codex/view';
import { removeMemory, restoreMemory, type RemovedMemory } from './chatApi';
import type { MemoryFile } from './cards/memoryLogic';

// Puts text into the composer; the composer listens.
export const insertText = (text: string) => window.dispatchEvent(new CustomEvent('agentview:insert', { detail: { text } }));

// The turn whose tool calls each host shows (the desktop rail, the phone's work tab), so the tools button can toggle.
export const shownWork = createStore<Record<string, string | null>>({});
export const setShownWork = (host: string, turn: string | null) => shownWork.patch({ [host]: turn });
export const workShown = (turn: string) => Object.values(shownWork.get()).includes(turn);

// Opens one turn's tool calls in their own tab, or closes them when that turn's are already shown; the workbench listens.
export const toggleWork = (turn: string) => window.dispatchEvent(new CustomEvent(workShown(turn) ? 'close-work' : 'open-work', { detail: turn }));

// Side chat (like Claude desktop's): forks this chat into the column beside it, so a question does not land in the
// running chat. The server views the fork once it starts; the original moves back to the main column.
export function sideChat() {
  const { id, sessionId } = getState().session;
  if (!sessionId || embedded) return;
  send({ type: 'new_session', fork: sessionId });
  const stop = subscribe(() => {
    const now = getState().session.id;
    if (!now || now === id) return;
    stop();
    send({ type: 'view', id });
    setUi({ beside: now });
  });
  setTimeout(stop, 30_000);
}

// Fork from here: a new chat holding this one up to and with the reply; the server opens it.
export const forkReply = (replyId: string) => send({ type: 'new_session', upTo: replyId });

// Fork chat: a new chat in the same folder and model that starts by summarising this one.
export function forkChat() {
  const { id, sessionId, model, provider } = getState().session;
  if (!sessionId) return;
  send({ type: 'new_session', ...(model && { model }), ...(provider && { provider }) });
  const stop = subscribe(() => {
    const now = getState().session.id;
    if (!now || now === id) return;
    stop();
    prompt(handoffText(sessionId), () => notice('The summary was not requested. Try Fork again'));
  });
  setTimeout(stop, 30_000);
}

// Deletes a memory file and its MEMORY.md lines; Undo puts them back, then runs `restored`. True once the file is gone.
export async function forgetMemory(file: MemoryFile, restored: () => void) {
  let removed: RemovedMemory;
  try {
    removed = await removeMemory(file.path);
  } catch {
    showSnack('Could not forget the memory');
    return false;
  }
  showSnack('Memory forgotten', () => {
    restoreMemory(file.path, removed).then(() => restored(), () => showSnack('Could not restore the memory'));
  });
  return true;
}

export function copyReply(text: string) {
  copyText(text, 'Reply copied');
}

export function copyResumeCommand(command: string) {
  copyText(command, 'Copied. Stop this chat before resuming it in a terminal');
}

// A pane sends a prompt and shows the chat, so the reply is seen.
export function askChat(text: string) {
  showChat();
  send({ type: 'prompt', text });
}

export const retry = () => send({ type: 'retry' });
export const resume = () => send({ type: 'steer', text: 'continue' });
export const steer = (text: string, chat?: string) => send({ type: 'steer', text }, chat);
export const sendNow = (id: string) => send({ type: 'send_now', id });
export const interrupt = () => send({ type: 'interrupt' });
export const compact = () => send({ type: 'prompt', text: '/compact' });
export const stopTask = (toolUseId: string) => send({ type: 'stop_task', toolUseId });
export const rewindFiles = (id: string) => send({ type: 'rewind', id });
export const answerPermission = (id: string, allow: boolean, always?: boolean, chat?: string) => send({ type: 'permission', id, allow, always }, chat);
export const answerQuestion = (id: string, answers: Record<string, string>, chat?: string) => send({ type: 'answer', id, answers }, chat);
export const allowBlocked = (id: string) => send({ type: 'allow_blocked', id });
export const reviewChange = (id: string, action: 'keep' | 'undo', file?: string, hunk?: number) => send({ type: 'review', id, action, file, hunk });
export const setModel = (model: string) => send({ type: 'set_model', model });
export const setEffort = (effort: string) => send({ type: 'set_effort', effort });
export const setAccount = (account: string) => send({ type: 'set_account', account });

export function setMode(step: { mode: string | null; review: boolean | null }) {
  if (step.mode) send({ type: 'set_permission_mode', mode: step.mode });
  if (step.review !== null) send({ type: 'set_review', on: step.review });
}
