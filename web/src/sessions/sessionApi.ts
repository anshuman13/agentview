import { api } from '../app/store';
import { apiUrl, fetchJson } from '../app/api';
import type { BuildDetail, BuildRow, ReviewPhase } from '../../../shared/builds';

export const deleteRequest = (url: string) => fetch(apiUrl(url), { method: 'DELETE' }).catch(() => null);

export const createFolder = (root: string, name: string) => fetch(apiUrl('/api/folders'), { method: 'POST', body: JSON.stringify({ root, name }) }).catch(() => null);

export const searchMessages = (q: string) => fetch(api(`/api/sessions/search?q=${encodeURIComponent(q)}`)).then((r) => r.json());

export const attentionPost = (path: string, id: string) => fetch(api(path), { method: 'POST', body: JSON.stringify({ id }) }).then((r) => r.json());

export const fetchBuilds = () => fetchJson<BuildRow[]>(api('/api/builds'));

export const fetchBuild = (slug: string) => fetchJson<BuildDetail>(api(`/api/builds/one?slug=${encodeURIComponent(slug)}`));

const postReview = (body: object) => fetchJson<{ ok: true }>(api('/api/builds/review'), { method: 'POST', body: JSON.stringify(body) });

export const postBuildReview = (slug: string, phase: ReviewPhase | 'code', decision: 'approve' | 'changes', note: string) => postReview({ slug, phase, decision, note });

export const postBuildHold = (slug: string, decision: 'hold' | 'release') => postReview({ slug, decision });
