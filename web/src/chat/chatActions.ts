import { embedded, getState, notice, prompt, send, setUi, subscribe } from '../app/store';
import { showChat } from '../ui/util';
import { chatMarkdown, handoffText, lastReply, replyNote } from './composer/composerLogic';
import { assistantStore } from '../codex/data';
import { restatedClaim, rememberedFact } from '../codex/data/wiki/wiki';
import { copyText, showSnack } from '../codex/view';
import { profileOfPath } from '../../../shared/workspace';
import { removeMemory, restoreMemory, type RemovedMemory } from './chatApi';
import { memoryClaimText, type MemoryFile } from './cards/memoryLogic';

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

// A live Memory claim in the chat's profile, superseding the Memory claim it restates; its undo deletes it and clears that.
function rememberClaim(text: string) {
  const st = getState();
  const { cwd } = st.session;
  const profile = profileOfPath(cwd);
  const store = assistantStore();
  const old = restatedClaim(text, store.snapshot().facts, profile);
  const fact = rememberedFact(text, profile, st.live.find((c) => c.id === st.session.id)?.title ?? '', cwd);
  void store.editRow('facts', fact, old ? { replaces: old.id } : {});
  if (old) void store.editRow('facts', old, { superseded_by: fact.id });
  const undo = () => {
    void store.editRow('facts', fact, { deleted: 1 });
    if (old) void store.editRow('facts', old, { superseded_by: null });
  };
  return { replaced: !!old, undo };
}

export function rememberChat(text: string) {
  const { replaced, undo } = rememberClaim(text);
  showSnack(replaced ? 'Saved to Memory, replacing a similar claim' : 'Saved to Memory', undo);
}

// Makes a memory file a Memory claim and removes the file; Undo puts the file and its MEMORY.md lines back and deletes the claim, then runs `restored`. True once the file is gone.
export async function moveMemoryToWiki(file: MemoryFile, restored: () => void) {
  const claim = rememberClaim(memoryClaimText(file));
  let removed: RemovedMemory;
  try {
    removed = await removeMemory(file.path);
  } catch {
    claim.undo();
    showSnack('Could not move the memory');
    return false;
  }
  showSnack(claim.replaced ? 'Moved to wiki, replacing a similar claim' : 'Moved to wiki', () => {
    claim.undo();
    restoreMemory(file.path, removed).then(restored, () => showSnack('Could not restore the memory'));
  });
  return true;
}

export function copyChatMarkdown() {
  const st = getState();
  copyText(chatMarkdown(st.events, st.live.find((c) => c.id === st.session.id)?.title ?? ''), 'Chat copied');
}

export function copyReply(text: string) {
  copyText(text, 'Reply copied');
}

export function copyLastReply() {
  const reply = lastReply(getState().events);
  if (reply) copyReply(reply);
}

export function copyPrompt(text: string) {
  copyText(text, 'Prompt copied');
}

export function copyResumeCommand(command: string) {
  copyText(command, 'Copied. Stop this chat before resuming it in a terminal');
}

// A pane sends a prompt and shows the chat, so the reply is seen.
export function askChat(text: string) {
  showChat();
  send({ type: 'prompt', text });
}
