import { apiUrl } from '../api';
import { api } from '../store';
import type { Connect } from './macName';

export const connectInfo = <T = Connect>(query: string): Promise<T> => fetch(apiUrl(`/api/connect?${query}`)).then((r) => r.json());

export const pingMac = (url: string) => fetch(`${url}/api/connect?peer=1`, { mode: 'no-cors', signal: AbortSignal.timeout(4000) });

export const openExternal = (url: string) => void fetch(api('/api/open'), { method: 'POST', body: JSON.stringify({ url }) });
