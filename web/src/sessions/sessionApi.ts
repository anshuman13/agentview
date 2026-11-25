import { api } from '../app/store';
import { apiUrl, fetchJson, SLOW_READ_MS } from '../app/api';

export const deleteRequest = (url: string) => fetch(apiUrl(url), { method: 'DELETE' }).catch(() => null);

export const createFolder = (root: string, name: string) => fetch(apiUrl('/api/folders'), { method: 'POST', body: JSON.stringify({ root, name }) }).catch(() => null);

export const searchMessages = (q: string) => fetch(api(`/api/sessions/search?q=${encodeURIComponent(q)}`)).then((r) => r.json());

export const attentionPost = (path: string, id: string) => fetch(api(path), { method: 'POST', body: JSON.stringify({ id }) }).then((r) => r.json());

export type RunDiff = { branch?: string; base: string; files: { path: string; additions: number; deletions: number }[]; diff: string };

const runUrl = (action: string, run: string) => api(`/api/runs/${action}?run=${encodeURIComponent(run)}`);

export const fetchRunDiff = (run: string) => fetchJson<RunDiff>(runUrl('diff', run), undefined, SLOW_READ_MS);

export const postRunApprove = (run: string) => fetchJson<{ url: string }>(runUrl('approve', run), { method: 'POST' });

export const postRunRevise = (run: string, text: string) => fetchJson<{ ok: true }>(runUrl('revise', run), { method: 'POST', body: JSON.stringify({ text }) });

export const postRunDiscard = (run: string) => fetchJson<{ ok: true }>(runUrl('discard', run), { method: 'POST' });

