import { api } from '../app/store';

// api() adds the shown chat after this one, and the server reads the first chat param.
export const fileRequest = (path: string, init?: RequestInit, chat?: string) => fetch(api(`/api/file?${chat ? `chat=${encodeURIComponent(chat)}&` : ''}path=${encodeURIComponent(path)}`), init);

export const listFiles = () => fetch(api('/api/files')).then((r) => r.json());

export const listDir = (path: string) => fetch(api(`/api/dir?path=${encodeURIComponent(path)}`));

export const fetchGitStatus = () => fetch(api('/api/git/status'));
