import { api } from '../app/store';
import { apiUrl } from '../app/api';

export const fileRequest = (path: string, init?: RequestInit, chat?: string) => {
  const url = `/api/file?path=${encodeURIComponent(path)}`;
  return fetch(chat ? apiUrl(`${url}&chat=${encodeURIComponent(chat)}`) : api(url), init);
};

export const listFiles = () => fetch(api('/api/files')).then((r) => r.json());

export const listDir = (path: string) => fetch(api(`/api/dir?path=${encodeURIComponent(path)}`));

export const fetchGitStatus = () => fetch(api('/api/git/status'));
