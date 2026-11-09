import { api } from '../app/store';

export const fileRequest = (path: string, init?: RequestInit) => fetch(api(`/api/file?path=${encodeURIComponent(path)}`), init);

export const listFiles = () => fetch(api('/api/files')).then((r) => r.json());

export const listDir = (path: string) => fetch(api(`/api/dir?path=${encodeURIComponent(path)}`));

export const fetchGitStatus = () => fetch(api('/api/git/status'));
