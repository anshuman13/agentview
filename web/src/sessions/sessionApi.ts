import { api } from '../app/store';
import { apiUrl, fetchJson } from '../app/api';
import type { BuildDetail, ReviewPhase } from '../../../shared/builds';

export const deleteRequest = (url: string) => fetch(apiUrl(url), { method: 'DELETE' }).catch(() => null);

export const createFolder = (root: string, name: string) => fetch(apiUrl('/api/folders'), { method: 'POST', body: JSON.stringify({ root, name }) }).catch(() => null);

export const searchMessages = (q: string) => fetch(api(`/api/sessions/search?q=${encodeURIComponent(q)}`)).then((r) => r.json());

export const attentionPost = (path: string, id: string) => fetch(api(path), { method: 'POST', body: JSON.stringify({ id }) }).then((r) => r.json());


// Resolves null when the build does not exist (404).
export async function fetchBuild(slug: string): Promise<BuildDetail | null> {
  const r = await fetch(api(`/api/builds/one?slug=${encodeURIComponent(slug)}`));
  if (r.status === 404) return null;
  const body = await r.json().catch(() => null);
  if (!r.ok || body?.error) throw new Error(body?.error ?? `Request failed (${r.status})`);
  return body;
}

const postReview = (body: object) => fetchJson<{ ok: true }>(api('/api/builds/review'), { method: 'POST', body: JSON.stringify(body) });

export const postBuildReview = (slug: string, phase: ReviewPhase | 'code', decision: 'approve' | 'changes', note: string) => postReview({ slug, phase, decision, note });

export const postBuildHold = (slug: string, decision: 'hold' | 'release') => postReview({ slug, decision });

export type RunDiff = { branch?: string; base: string; files: { path: string; additions: number; deletions: number }[]; diff: string };

const runUrl = (action: string, run: string) => api(`/api/runs/${action}?run=${encodeURIComponent(run)}`);

export const fetchRunDiff = (run: string) => fetchJson<RunDiff>(runUrl('diff', run));

export const postRunApprove = (run: string) => fetchJson<{ url: string }>(runUrl('approve', run), { method: 'POST' });

export const postRunRevise = (run: string, text: string) => fetchJson<{ ok: true }>(runUrl('revise', run), { method: 'POST', body: JSON.stringify({ text }) });

export const postRunDiscard = (run: string) => fetchJson<{ ok: true }>(runUrl('discard', run), { method: 'POST' });
