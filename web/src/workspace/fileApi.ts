import { api } from '../app/store';
import { apiUrl, fetchJson } from '../app/api';

export const fileRequest = (path: string, init?: RequestInit, chat?: string) => {
  const url = `/api/file?path=${encodeURIComponent(path)}`;
  return fetch(chat ? apiUrl(`${url}&chat=${encodeURIComponent(chat)}`) : api(url), init);
};

export const listFiles = () => fetch(api('/api/files')).then((r) => r.json());

export const listDir = (path: string) => fetch(api(`/api/dir?path=${encodeURIComponent(path)}`));

export const fetchGitStatus = () => fetch(api('/api/git/status'));

export const postGit = (action: string, body: unknown) =>
  fetchJson(api(`/api/git/${action}`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const isDocPath = (path: string) => /\.(md|markdown|mdx)$/i.test(path);

export type SketchFile = { name: string; path: string; mtime: number };

export const fetchSketches = () => fetchJson<SketchFile[]>(api('/api/sketches'));

export const readSketch = (path: string) => fetchJson<{ content: string; binary?: boolean }>(api(`/api/file?path=${encodeURIComponent(path)}`));
