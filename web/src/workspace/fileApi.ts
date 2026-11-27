import type { GitCommit } from '../../../shared/protocol';
import { api } from '../app/store';
import { apiUrl, fetchJson } from '../app/api';

export const fileRequest = (path: string, init?: RequestInit, chat?: string) => {
  const url = `/api/file?path=${encodeURIComponent(path)}`;
  return fetch(chat ? apiUrl(`${url}&chat=${encodeURIComponent(chat)}`) : api(url), init);
};

export const listFiles = () => fetch(api('/api/files')).then((r) => r.json());

export const listDir = (path: string) => fetch(api(`/api/dir?path=${encodeURIComponent(path)}`));

export const fetchGitStatus = () => fetch(api('/api/git/status'));

export type DiffFiles = { files: { path: string; additions: number; deletions: number }[]; diff: string };

export type BranchDiff = DiffFiles & { base: string; commits?: GitCommit[] };

export const fetchBranchDiff = () => fetchJson<BranchDiff>(api('/api/git/branch'));

export const fetchCommitDiff = (hash: string) => fetchJson<DiffFiles>(api(`/api/git/show?hash=${encodeURIComponent(hash)}`));

export const postGit = (action: string, body: unknown) =>
  fetchJson(api(`/api/git/${action}`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const isDocPath = (path: string) => /\.(md|markdown|mdx)$/i.test(path);

export type SketchFile = { name: string; path: string; mtime: number };

export const fetchSketches = () => fetchJson<SketchFile[]>(api('/api/sketches'));

export const readSketch = (path: string) => fetchJson<{ content: string; binary?: boolean }>(api(`/api/file?path=${encodeURIComponent(path)}`));

export const renameSketch = (name: string, to: string) =>
  fetchJson<SketchFile>(api(`/api/sketches/rename?name=${encodeURIComponent(name)}&to=${encodeURIComponent(to)}`), { method: 'POST' });

export const deleteSketch = (name: string) => fetchJson(api(`/api/sketches?name=${encodeURIComponent(name)}`), { method: 'DELETE' });

// Saves the sketch's HTML through the browser's download.
export async function downloadSketch(file: SketchFile) {
  const { content } = await readSketch(file.path);
  const url = URL.createObjectURL(new Blob([content], { type: 'text/html' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type SearchHit = { path: string; line: number; text: string };

export const searchFiles = (q: string) => fetchJson<{ hits: SearchHit[]; more: boolean }>(api(`/api/search?q=${encodeURIComponent(q)}`));
