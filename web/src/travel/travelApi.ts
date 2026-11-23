import { apiUrl, fetchJson } from '../app/api';
import type { PlanItem, Receipt, Trip, TravelData } from '../../../shared/travel';

const post = <T>(path: string, body: unknown) => fetchJson<T>(apiUrl(path), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const fetchTravel = () => fetchJson<TravelData>(apiUrl('/api/travel'));
export const saveTrip = (t: { id?: string; name: string; from: string; to: string; notes?: string; plan?: (Partial<PlanItem> & Pick<PlanItem, 'title' | 'day'>)[] }) => post<Trip>('/api/travel/trip', t);
export const scanCalendar = () => post<{ added: number; updated: number }>('/api/travel/scan', {});
export const deleteTrip = (id: string) => post('/api/travel/trip/delete', { id });
export const updateReceipt = (r: Partial<Receipt> & { id: string }) => post<Receipt>('/api/travel/receipt/update', r);
export const deleteReceipt = (id: string) => post('/api/travel/receipt/delete', { id });
// An empty trip files the receipt by its date.
export const uploadReceipt = (trip: string, f: Blob, name: string) =>
  fetchJson<Receipt>(apiUrl(`/api/travel/receipt?trip=${encodeURIComponent(trip)}&name=${encodeURIComponent(name)}`), { method: 'POST', headers: { 'content-type': f.type || 'application/octet-stream' }, body: f });
export const receiptUrl = (id: string) => apiUrl(`/api/travel/file?id=${encodeURIComponent(id)}`);
export const exportUrl = (trip: string) => apiUrl(`/api/travel/export?trip=${encodeURIComponent(trip)}`);
