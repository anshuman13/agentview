import { embedded, getState, notice, prompt, send, setUi, subscribe } from '../app/store';
import { copyText, showChat } from '../ui/util';
import { chatMarkdown, handoffText, replyNote } from './composer/composerLogic';
import { assistantStore } from '../codex/data';
import { rememberChanges, rememberedFact } from '../codex/data/wiki/wiki';
import { showSnack } from '../codex/view';
import { profileOfPath } from '../../../shared/workspace';

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

// A task "Check <chat>" due at the picked time, linked to the chat; the hub pushes it when due.
export async function remindChat(at: number) {
  const st = getState();
  const { sessionId, cwd } = st.session;
  if (!sessionId) return;
  const title = st.live.find((c) => c.id === st.session.id)?.title || 'chat';
  const { profile } = replyNote('', title, cwd);
  const store = assistantStore();
  const row = await store.capture(`Check ${title}`, 'task', profile, at);
  await store.update(row, { source: 'chat', source_url: `${location.origin}/?session=${sessionId}` });
}

// A live Memory claim in the chat's profile, superseding the Memory claim it restates; Undo deletes it and clears that.
export function rememberChat(text: string) {
  const st = getState();
  const { cwd } = st.session;
  const profile = profileOfPath(cwd);
  const store = assistantStore();
  const old = rememberChanges(text, store.snapshot().facts, profile);
  const fact = rememberedFact(text, profile, st.live.find((c) => c.id === st.session.id)?.title ?? '', cwd);
  void store.editRow('facts', fact, old ? { replaces: old.id } : {});
  if (old) void store.editRow('facts', old, { superseded_by: fact.id });
  showSnack(old ? 'Saved to Memory, replacing a similar claim' : 'Saved to Memory', () => {
    void store.editRow('facts', fact, { deleted: 1 });
    if (old) void store.editRow('facts', old, { superseded_by: null });
  });
}

export function copyChatMarkdown() {
  const st = getState();
  copyText(chatMarkdown(st.events, st.live.find((c) => c.id === st.session.id)?.title ?? '')).then(() => notice('Copied the chat as Markdown'), () => notice('Could not copy'));
}

export function copyResumeCommand(command: string) {
  copyText(command).then(() => notice('Copied. Stop this chat before resuming it in a terminal'), () => notice('Could not copy'));
}

// A pane sends a prompt and shows the chat, so the reply is seen.
export function askChat(text: string) {
  showChat();
  send({ type: 'prompt', text });
}
