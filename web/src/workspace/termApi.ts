import { apiUrl } from '../app/api';

const url = (chat: string, q = '') => apiUrl(`/api/terms?chat=${encodeURIComponent(chat)}${q}`);

export const listTerms = (chat: string) => fetch(url(chat));

export const createTerm = (chat: string) => fetch(url(chat), { method: 'POST' });

export const closeTerm = (chat: string, id: string) => fetch(url(chat, `&id=${encodeURIComponent(id)}`), { method: 'DELETE' });
