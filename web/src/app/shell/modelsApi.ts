import { apiUrl, fetchJson } from '../api';
import type { Provider, PublicSettings } from '../../../../shared/protocol';
import type { ModelSlot, OpenRouterModels, OpenRouterView } from '../../../../shared/openrouter';

export const fetchOpenRouter = () => fetchJson<OpenRouterView>(apiUrl('/api/openrouter'));

export const saveOpenRouter = (body: { key: string; default: ModelSlot; models: OpenRouterModels }) => fetchJson<OpenRouterView>(apiUrl('/api/openrouter'), { method: 'POST', body: JSON.stringify(body) });

export const saveDefaultProvider = (defaultProvider: Provider) => fetchJson<PublicSettings>(apiUrl('/api/settings'), { method: 'POST', body: JSON.stringify({ defaultProvider }) });
