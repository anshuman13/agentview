import type { PublicSettings } from '../../../shared/protocol';
import type { UseDays } from '../../../shared/featureUse';
import { apiUrl, fetchJson } from './api';

export const postFeatureUse = (id: string) => fetchJson<{ recorded: boolean }>(apiUrl('/api/feature-use'), { method: 'POST', body: JSON.stringify({ id }) });

export const fetchFeatureUse = () => fetchJson<{ on: boolean; days: UseDays }>(apiUrl('/api/feature-use'));

export const saveFeatureUse = (featureUse: boolean) => fetchJson<PublicSettings>(apiUrl('/api/settings'), { method: 'POST', body: JSON.stringify({ featureUse }) });
