import { api } from '../app/store';
import { apiUrl, fetchJson } from '../app/api';

export const fetchTodos = () => fetch(api('/api/git/todos')).then((r) => r.json());

export const fetchMemory = () => fetch(api('/api/memory')).then((r) => r.json());

export const fetchSavedSessions = () => fetch(api('/api/sessions')).then((r) => r.json());

export const uploadPaste = (f: File) => fetchJson<{ path: string }>(apiUrl(`/api/paste?name=${encodeURIComponent(f.name || 'pasted')}`), { method: 'POST', headers: { 'content-type': f.type || 'application/octet-stream' }, body: f });
