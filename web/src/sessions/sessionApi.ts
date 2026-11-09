import { api } from '../app/store';
import { apiUrl } from '../app/api';

export const deleteRequest = (url: string) => fetch(apiUrl(url), { method: 'DELETE' }).catch(() => null);

export const createFolder = (root: string, name: string) => fetch(apiUrl('/api/folders'), { method: 'POST', body: JSON.stringify({ root, name }) }).catch(() => null);

export const searchMessages = (q: string) => fetch(api(`/api/sessions/search?q=${encodeURIComponent(q)}`)).then((r) => r.json());

export const attentionPost = (path: string, id: string) => fetch(api(path), { method: 'POST', body: JSON.stringify({ id }) }).then((r) => r.json());
