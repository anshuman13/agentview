import { api } from '../app/store';
import { apiUrl, fetchJson } from '../app/api';

export const fetchTodos = () => fetch(api('/api/git/todos')).then((r) => r.json());

export const fetchMemory = () => fetch(api('/api/memory')).then((r) => r.json());

// Replaces a memory file's body; resolves to the body it had.
export const saveMemory = (path: string, text: string) =>
  fetchJson<{ previous: string }>(api('/api/memory/save'), { method: 'POST', body: JSON.stringify({ path, text }) }).then((r) => r.previous);

export const fetchSavedSessions = () => fetch(api('/api/sessions')).then((r) => r.json());

export const imageUrl = (path: string) => api(`/api/image?path=${encodeURIComponent(path)}`);

export const uploadPaste = (f: File) => fetchJson<{ path: string }>(apiUrl(`/api/paste?name=${encodeURIComponent(f.name || 'pasted')}`), { method: 'POST', headers: { 'content-type': f.type || 'application/octet-stream' }, body: f });
