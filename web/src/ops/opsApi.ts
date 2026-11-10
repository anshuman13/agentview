import type { GrafanaDashboards, GrafanaLogs, GrafanaPanels, GrafanaPatterns, ObserveInfo, SnowflakeObjects, SnowflakeResult, SnowflakeTest } from '../../../shared/observe';
import type { DeployJob, PullRequest, PullRequestDetail, Repo, ReviewFindings } from '../../../shared/protocol';
import { apiUrl, fetchJson } from '../app/api';
import { api } from '../app/store';

const get = <T>(path: string) => fetchJson<T>(api(path));

const post = <T>(path: string, body?: unknown) =>
  fetchJson<T>(api(path), body === undefined ? { method: 'POST' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const q = encodeURIComponent;

export const fetchDeployJob = (id: string) => fetch(api(`/api/deploy/job/${id}`)).then((r) => r.json());

export const fetchDeployStatus = (app: string) => fetch(api(`/api/deploy/status${app ? `?app=${q(app)}` : ''}`)).then((r) => r.json());

export const fetchMcpConnectors = (refresh: boolean) => fetch(api(`/api/mcp/connectors${refresh ? '?refresh=1' : ''}`)).then((r) => r.json());

export const fetchMcpProbe = (refresh: boolean) => fetch(api(`/api/mcp/probe${refresh ? '?refresh=1' : ''}`)).then((r) => r.json());

export const fetchMcpGroups = () => fetch(api('/api/mcp/groups')).then((r) => r.json());

export const saveMcpGroup = (service: string, group: string) => post<any>('/api/mcp/groups', { service, group });

export const addMcp = (name: string) => post<any>(`/api/mcp/add?name=${q(name)}`);

export const loginMcp = (name: string) => post<any>(`/api/mcp/login?name=${q(name)}`);

export const callMcp = (server: string, tool: string, args: unknown) => post<any>('/api/mcp/call', { server, tool, args });

export const openUrl = (url: string, browser: string) => post<any>('/api/open', { url, browser });

export const pasteText = (name: string, text: string) =>
  fetchJson<{ path: string }>(api(`/api/paste?name=${q(name)}`), { method: 'POST', headers: { 'content-type': 'text/plain' }, body: text });

export const fetchRepos = () => fetchJson<Repo[]>(apiUrl('/api/repos'));

export const fetchObserve = (repo: string) => get<ObserveInfo>(`/api/observe${repo ? `?repo=${q(repo)}` : ''}`);

export const saveObserveConfig = (repo: string, config: unknown) => post<ObserveInfo>('/api/observe/config', { repo, config });

export const addToClaude = (server: string) => post<{ info: ObserveInfo }>('/api/observe/mcp/add', { server });

export const fetchSnowflakeObjects = (kind: string, parent: string) => get<SnowflakeObjects>(`/api/observe/snowflake/objects?kind=${kind}&${parent}`);

export const saveSnowflakeConfig = (snowflake: unknown) => post<ObserveInfo>('/api/observe/snowflake/config', { snowflake });

export const testSnowflake = () => post<SnowflakeTest>('/api/observe/snowflake/test', {});

export const querySnowflake = (sql: string) => post<SnowflakeResult>('/api/observe/snowflake/query', { sql });

export const fetchGrafanaDashboards = (repo: string) => get<GrafanaDashboards>(`/api/observe/grafana/dashboards?repo=${q(repo)}`);

export const fetchGrafanaPanels = (repo: string) => get<GrafanaPanels>(`/api/observe/grafana/panels?repo=${q(repo)}`);

export const fetchGrafanaLogs = (repo: string) => get<GrafanaLogs>(`/api/observe/grafana/logs?repo=${q(repo)}`);

export const fetchGrafanaPatterns = (repo: string) => get<GrafanaPatterns>(`/api/observe/grafana/patterns?repo=${q(repo)}`);

export const runDeploy = (app: string, env: string, ref: string | undefined) => post<DeployJob>('/api/deploy/run', { app, env, ref });

export const rollbackDeploy = (app: string, env: string, sha: string) => post<DeployJob>('/api/deploy/rollback', { app, env, sha });

export const fetchFindings = (target: string) => get<ReviewFindings | null>(`/api/findings?target=${q(target)}`);

export const dismissFinding = (target: string, key: string) => post<ReviewFindings | null>('/api/findings/dismiss', { target, key });

export const fetchPulls = (fresh: boolean) => get<PullRequest[]>(`/api/gh/prs${fresh ? '?fresh=1' : ''}`);

export const fetchPull = (number: number) => get<PullRequestDetail>(`/api/gh/pr/${number}`);

export const actOnPull = (number: number, action: string, body: object) => post(`/api/gh/pr/${number}/${action}`, body);
