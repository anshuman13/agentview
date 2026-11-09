import { ACCOUNT_LABEL, type ProviderOption, type PublicSettings } from '../../../shared/protocol';
import { WORKSPACE } from '../../../shared/workspace';
import { createStore } from '../ui/createStore';
import { apiUrl, fetchJson } from './api';

export const appSettings = createStore<{ deploy: boolean; providers: ProviderOption[]; roots: string[] }>({ deploy: false, providers: [], roots: ['workspace'] });

// The server's settings file decides which integrations show and what the Claude accounts are called.
export async function loadAppSettings() {
  const s = await fetchJson<PublicSettings>(apiUrl('/api/settings')).catch(() => null);
  if (!s) return;
  Object.assign(ACCOUNT_LABEL, s.accountLabels);
  WORKSPACE.personalRoot = s.personalRoot ?? '';
  appSettings.patch({ deploy: s.deploy, providers: s.providers ?? [], roots: s.roots ?? ['workspace'] });
}
