import { api, getState, notice } from '../app/store';
import { apiUrl, fetchJson, wsUrl } from '../app/api';
import type { MemoryFile } from './cards/memoryLogic';
import type { SubChat } from './transcript/subChatsLogic';
import type { ChatEvent, SpawnedBuild } from '../../../shared/protocol';
import { appendRule, removeRule } from '../../../shared/steering';
import { createTerm, listTerms } from '../workspace/termApi';
import { fileRequest } from '../workspace/fileApi';

async function terminalId(chat: string): Promise<string | null> {
  try {
    const listed = await listTerms(chat);
    if (!listed.ok) return null;
    const list: Array<{ id: string }> = await listed.json();
    let term = list.at(-1);
    if (!term) {
      const created = await createTerm(chat);
      if (!created.ok) return null;
      term = await created.json();
    }
    return term?.id ?? null;
  } catch {
    return null;
  }
}

// Types the command into the chat's last terminal (or a new one) and shows it; with enter false the user presses Enter.
export async function runInTerminal(cmd: string, enter: boolean) {
  const id = await terminalId(getState().session.id);
  if (!id) return notice('Terminal unavailable');
  window.dispatchEvent(new CustomEvent('agentview:terminal', { detail: id }));
  const ws = new WebSocket(wsUrl(`term=${encodeURIComponent(id)}`));
  ws.onerror = () => notice('Terminal unavailable');
  ws.onopen = () => {
    ws.send(JSON.stringify({ t: 'i', d: enter ? `${cmd}\r` : cmd }));
    ws.close();
  };
}

export const fetchTodos = () => fetch(api('/api/git/todos')).then((r) => r.json());

export const fetchMemory = () => fetchJson<MemoryFile[]>(api('/api/memory'));

// Replaces a memory file's body; resolves to the body it had.
export const saveMemory = (path: string, text: string) =>
  fetchJson<{ previous: string }>(api('/api/memory/save'), { method: 'POST', body: JSON.stringify({ path, text }) }).then((r) => r.previous);

export type RemovedMemory = { raw: string; lines: string[] };

// Deletes a memory file and its MEMORY.md lines; resolves to both, for restoreMemory.
export const removeMemory = (path: string) => fetchJson<RemovedMemory>(api('/api/memory/remove'), { method: 'POST', body: JSON.stringify({ path }) });

export const restoreMemory = (path: string, removed: RemovedMemory) =>
  fetchJson(api('/api/memory/restore'), { method: 'POST', body: JSON.stringify({ path, ...removed }) });

async function readRepoFile(file: string, chat?: string): Promise<string> {
  const r = await fileRequest(file, undefined, chat);
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()).content ?? '';
}

async function writeRepoFile(file: string, text: string, chat?: string) {
  const r = await fileRequest(file, { method: 'PUT', body: text }, chat);
  if (!r.ok) throw new Error(await r.text());
}

// Appends a bullet to the instruction file and returns an undo that reads the file again and removes only that bullet.
export async function addRepoRule(file: string, text: string, chat?: string) {
  await writeRepoFile(file, appendRule(await readRepoFile(file, chat), text)!, chat);
  return async () => {
    const left = removeRule(await readRepoFile(file, chat), text);
    if (left !== null) await writeRepoFile(file, left, chat);
  };
}

export const fetchSavedSessions = () => fetch(api('/api/sessions')).then((r) => r.json());

// The builds this session's chat started, oldest first, for the transcript's build cards.
export const fetchSpawnedBuilds = (session: string) => fetchJson<SpawnedBuild[]>(api(`/api/chat/spawned?session=${encodeURIComponent(session)}`));

// The earlier sessions of the chat that holds this session, oldest first.
export const fetchSubChats = (session: string) => fetchJson<SubChat[]>(api(`/api/chat/subchats?session=${encodeURIComponent(session)}`));

// A page of a sub-chat's saved events, read-only; an empty before gives the last page.
export const fetchSubChatEvents = (session: string, before = '', limit = 150) =>
  fetchJson<{ events: ChatEvent[]; earlier?: number }>(api(`/api/chat/subchat-events?session=${encodeURIComponent(session)}&before=${encodeURIComponent(before)}&limit=${limit}`));

// A text file in the chat's folder, such as a build spec.
export const fetchTextFile = (path: string) => fetchJson<{ content: string }>(api(`/api/file?path=${encodeURIComponent(path)}`)).then((r) => r.content);

export const imageUrl = (path: string) => api(`/api/image?path=${encodeURIComponent(path)}`);

export const uploadPaste = (f: File) => fetchJson<{ path: string }>(apiUrl(`/api/paste?name=${encodeURIComponent(f.name || 'pasted')}`), { method: 'POST', headers: { 'content-type': f.type || 'application/octet-stream' }, body: f });
