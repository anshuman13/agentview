import { api } from '../app/store';
import { apiUrl, fetchJson } from '../app/api';
import type { MemoryFile } from './cards/memoryLogic';

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

export const fetchSavedSessions = () => fetch(api('/api/sessions')).then((r) => r.json());

export const imageUrl = (path: string) => api(`/api/image?path=${encodeURIComponent(path)}`);

export const uploadPaste = (f: File) => fetchJson<{ path: string }>(apiUrl(`/api/paste?name=${encodeURIComponent(f.name || 'pasted')}`), { method: 'POST', headers: { 'content-type': f.type || 'application/octet-stream' }, body: f });
