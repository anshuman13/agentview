import type { UsageReport } from '../../../shared/protocol';
import { fetchJson, SLOW_READ_MS } from '../app/api';
import { api } from '../app/store';

export const fetchUsage = (days = 30) => fetchJson<UsageReport>(api(`/api/usage?days=${days}`), undefined, SLOW_READ_MS);
