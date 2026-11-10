import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseObject } from '../json.js';
import type { ObserveConfig, ObserveInfo, SnowflakeConfig, SnowflakeInfo } from '../../../shared/observe.js';
import { provider } from '../agent/registry.js';
import type { Provider } from '../../../shared/protocol.js';
import { stop } from './mcpClient.js';
import { CLAUDE, EMPTY_SNOWFLAKE, FILE, configFor, guess, load, repoName, save, userServers, type Settings } from './observeSettings.js';
import { clearGrafanaCaches, dashboards, grafanaDef, logs, panels, patterns } from './observeGrafana.js';
import { hasDeployApp } from './deploy.js';
import { snowflakeDef, snowflakeObjects, snowflakeQuery, snowflakeTest } from './observeSnowflake.js';

const run = promisify(execFile);

const snowflakeInfo = (s: Settings): SnowflakeInfo => {
  const { secret, ...rest } = { ...EMPTY_SNOWFLAKE, ...s.snowflake };
  return { ...rest, hasSecret: !!secret };
};

async function info(repo: string, cwd: string, prov: Provider): Promise<ObserveInfo> {
  const [s, servers, own] = await Promise.all([load(), userServers(cwd, prov), repoName(cwd)]);
  return {
    repo,
    config: s.repos?.[repo] ?? null,
    guess: await guess(repo, s),
    repos: Object.keys(s.repos ?? {}),
    file: FILE,
    grafanaServer: !!servers.grafana,
    snowflake: snowflakeInfo(s),
    inChat: { snowflake: !!servers.snowflake },
    serversFile: provider(prov).serversFile,
    local: repo === own && !(await hasDeployApp(cwd)),
  };
}


async function saveSnowflake(input: unknown, cwd: string, prov: Provider) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Snowflake settings must be an object');
  const s = await load();
  const prev = { ...EMPTY_SNOWFLAKE, ...s.snowflake };
  const next: SnowflakeConfig = { ...prev };
  const inp = input as Record<string, unknown>;
  for (const k of ['account', 'user', 'warehouse', 'database', 'schema', 'role'] as const) if (typeof inp[k] === 'string') next[k] = (inp[k] as string).trim();
  if (inp.auth === 'pat' || inp.auth === 'password') next.auth = inp.auth;
  if (typeof inp.secret === 'string' && inp.secret) next.secret = inp.secret;
  await save({ ...s, snowflake: next });
  stop('snowflake');
  return info(await repoName(cwd), cwd, prov);
}

async function saveConfig(repo: string, b: Record<string, unknown>, cwd: string, prov: Provider) {
  const s = await load();
  const repos = { ...s.repos };
  if ('config' in b) {
    const config = b.config ?? null;
    if (config !== null && (typeof config !== 'object' || Array.isArray(config))) throw new Error('Config must be a JSON object');
    if (config) repos[repo] = config as ObserveConfig;
    else delete repos[repo];
  }
  await save({ ...s, repos });
  clearGrafanaCaches();
  return info(repo, cwd, prov);
}

async function addToClaude(server: string, cwd: string, prov: Provider) {
  const [s, servers] = await Promise.all([load(), userServers(cwd, 'claude')]);
  if (server !== 'snowflake') throw new Error('server must be snowflake');
  const def = await snowflakeDef(s);
  if (servers[server]) throw new Error(`${server} is already in your Claude MCP config`);
  // The CLI writes ~/.claude.json the same way running Claude sessions do, so neither overwrites the other.
  await run('claude', ['mcp', 'add-json', '--scope', 'user', server, JSON.stringify(def)], { timeout: 30_000 }).catch((err: { stderr?: string; message: string }) => {
    throw new Error(err.stderr?.trim() || err.message);
  });
  return { server, file: CLAUDE, info: await info(await repoName(cwd), cwd, prov) };
}

export async function observe(method: string, url: URL, cwd: string, prov: Provider, readBody: () => Promise<string>) {
  const p = url.pathname;
  if (method === 'POST') {
    const b = parseObject(await readBody());
    if (p === '/api/observe/config') {
      if (typeof b.repo !== 'string' || !b.repo.trim()) throw new Error('Missing repo');
      return saveConfig(b.repo.trim(), b, cwd, prov);
    }
    if (p === '/api/observe/snowflake/config') return saveSnowflake(b.snowflake, cwd, prov);
    if (p === '/api/observe/snowflake/test') return snowflakeTest();
    if (p === '/api/observe/snowflake/query') return snowflakeQuery(String(b.sql ?? ''));
    if (p === '/api/observe/mcp/add') return addToClaude(String(b.server ?? ''), cwd, prov);
    throw new Error('Not found');
  }
  const q = (k: string) => url.searchParams.get(k)?.trim() ?? '';
  if (p === '/api/observe/snowflake/objects') return snowflakeObjects(q('kind'), q('database'), q('schema'));
  const repo = q('repo') || (await repoName(cwd));
  if (p === '/api/observe') return info(repo, cwd, prov);
  if (p.startsWith('/api/observe/grafana/')) {
    const [s, servers] = await Promise.all([load(), userServers(cwd, prov)]);
    const def = grafanaDef(servers);
    const cfg = (await configFor(repo, s)).grafana;
    if (p === '/api/observe/grafana/dashboards') return dashboards(repo, cfg, def);
    if (p === '/api/observe/grafana/panels') return panels(cfg, def);
    if (p === '/api/observe/grafana/logs') return logs(cfg, def);
    if (p === '/api/observe/grafana/patterns') return patterns(cfg, def);
  }
  throw new Error('Not found');
}
