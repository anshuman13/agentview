import type { Connector, ConnectorGroup } from '../../../../shared/protocol.js';
import type { Connectors } from '../types.js';
import { codexAdmin } from './rpc.js';

type Rpc = { request<T>(method: string, params: unknown): Promise<T> };

export type AppInfo = { id: string; name: string; installUrl?: string | null; isAccessible?: boolean; isEnabled?: boolean; logoUrl?: string | null };
export type InstalledApp = { id: string; enabled: boolean; callable: boolean };

export function appConnector(app: AppInfo, installed?: InstalledApp): Connector {
  const enabled = installed?.enabled ?? app.isEnabled ?? true;
  const needsAuth = !app.isAccessible && !!app.installUrl;
  const status = !enabled ? 'off' : installed?.callable ? 'connected' : needsAuth ? 'needs-auth' : 'failed';
  return {
    id: app.id,
    name: app.name,
    status,
    enabled,
    ...(needsAuth && { signInUrl: app.installUrl! }),
    ...(app.logoUrl && { icon: app.logoUrl }),
  };
}

export async function listApps(rpc: Rpc, refresh: boolean): Promise<ConnectorGroup[]> {
  const apps: AppInfo[] = [];
  let cursor: string | null = null;
  do {
    const page: { data: AppInfo[]; nextCursor?: string | null } = await rpc.request('app/list', { cursor, limit: 200, forceRefetch: refresh });
    apps.push(...page.data);
    cursor = page.nextCursor ?? null;
  } while (cursor);
  const { apps: installed } = await rpc.request<{ apps: InstalledApp[] }>('app/installed', { forceRefresh: refresh });
  const byId = new Map(installed.map((a) => [a.id, a]));
  return [{ label: 'ChatGPT apps', connectors: apps.map((a) => appConnector(a, byId.get(a.id))) }];
}

export async function toggleApp(rpc: Rpc, id: string, on: boolean): Promise<boolean> {
  await rpc.request('config/value/write', { keyPath: `apps.${id}.enabled`, value: on, mergeStrategy: 'upsert' });
  return true;
}

export async function appSignIn(rpc: Rpc, id: string): Promise<string | null> {
  const { apps } = await rpc.request<{ apps: Array<{ id: string; installUrl?: string | null }> }>('app/read', { appIds: [id] });
  return apps.find((a) => a.id === id)?.installUrl ?? null;
}

export const codexConnectors: Connectors = {
  list: async (refresh) => listApps(await codexAdmin(), refresh),
  toggle: async (id, on) => toggleApp(await codexAdmin(), id, on),
  signIn: async (id) => appSignIn(await codexAdmin(), id),
};
