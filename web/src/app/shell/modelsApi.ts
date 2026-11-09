import { apiUrl, fetchJson } from '../api';
import type { ModelSlot, OpenRouterModels, OpenRouterView } from '../../../../shared/openrouter';

export const fetchOpenRouter = () => fetchJson<OpenRouterView>(apiUrl('/api/openrouter'));

export const saveOpenRouter = (body: { key: string; default: ModelSlot; models: OpenRouterModels }) => fetchJson<OpenRouterView>(apiUrl('/api/openrouter'), { method: 'POST', body: JSON.stringify(body) });
