import { type ClientMessage } from '../../../../shared/protocol';
import { apiUrl } from '../api';
import { api } from './core';

const SEEN_URL = '/api/sessions/seen';

export const fetchEarlier = (before: string, limit: number) => fetch(api(`/api/chat/events?before=${encodeURIComponent(before)}&limit=${limit}`));

export const postCommand = (url: string, m: ClientMessage) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(m), signal: AbortSignal.timeout(10_000) });

export const fetchSeen = () => fetch(apiUrl(SEEN_URL)).then((r) => r.json());

export const postSeen = (sessionId: string, unread = false) => fetch(apiUrl(`${SEEN_URL}?id=${encodeURIComponent(sessionId)}${unread ? '&unread=1' : ''}`), { method: 'POST' }).catch(() => {});
