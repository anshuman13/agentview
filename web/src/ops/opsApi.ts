import { api } from '../app/store';

export async function call<T>(path: string, body?: object): Promise<T> {
  const r = await fetch(api(path), body ? { method: 'POST', body: JSON.stringify(body) } : undefined);
  const data = await r.json().catch(() => ({ error: `Request failed (${r.status})` }));
  if (!r.ok || data?.error) throw new Error(data?.error ?? `Request failed (${r.status})`);
  return data;
}

export const fetchDeployJob = (id: string) => fetch(api(`/api/deploy/job/${id}`)).then((r) => r.json());

export const fetchDeployStatus = (app: string) => fetch(api(`/api/deploy/status${app ? `?app=${encodeURIComponent(app)}` : ''}`)).then((r) => r.json());

export const fetchMcpConnectors = (refresh: boolean) => fetch(api(`/api/mcp/connectors${refresh ? '?refresh=1' : ''}`)).then((r) => r.json());

export const fetchMcpProbe = (refresh: boolean) => fetch(api(`/api/mcp/probe${refresh ? '?refresh=1' : ''}`)).then((r) => r.json());

export const fetchMcpGroups = () => fetch(api('/api/mcp/groups')).then((r) => r.json());
