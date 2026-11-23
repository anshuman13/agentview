import { apiUrl, fetchJson } from '../app/api';
import type { Receipt, Trip, TravelData } from '../../../shared/travel';

const post = <T>(path: string, body: unknown) => fetchJson<T>(apiUrl(path), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const fetchTravel = () => fetchJson<TravelData>(apiUrl('/api/travel'));
export const saveTrip = (t: Partial<Trip>) => post<Trip>('/api/travel/trip', t);
export const deleteTrip = (id: string) => post('/api/travel/trip/delete', { id });
export const updateReceipt = (r: Partial<Receipt> & { id: string }) => post<Receipt>('/api/travel/receipt/update', r);
export const deleteReceipt = (id: string) => post('/api/travel/receipt/delete', { id });
export const uploadReceipt = (trip: string, f: Blob, name: string) =>
  fetchJson<Receipt>(apiUrl(`/api/travel/receipt?trip=${encodeURIComponent(trip)}&name=${encodeURIComponent(name)}`), { method: 'POST', headers: { 'content-type': f.type || 'application/octet-stream' }, body: f });
export const receiptUrl = (id: string) => apiUrl(`/api/travel/file?id=${encodeURIComponent(id)}`);
export const exportUrl = (trip: string) => apiUrl(`/api/travel/export?trip=${encodeURIComponent(trip)}`);
