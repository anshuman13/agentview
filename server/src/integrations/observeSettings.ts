import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { ROOTS } from '../workspace/files.js';
import { errText, inside } from '../../../shared/util.js';
import { allowedServers } from '../agent/claude/mcp.js';
import type { McpServerDef } from './mcpClient.js';
import type { ObserveConfig, SnowflakeConfig } from '../../../shared/observe.js';
import { writeJson } from '../json.js';
import { git } from '../workspace/git.js';

export const DIR = path.join(os.homedir(), '.agentview');
export const FILE = path.join(DIR, 'observe.json');
export const YAML = path.join(DIR, 'snowflake.yaml');
export const CLAUDE = path.join(os.homedir(), '.claude.json');

export type Settings = { snowflake?: Partial<SnowflakeConfig>; repos?: Record<string, ObserveConfig> };
export type Servers = Record<string, McpServerDef>;

export const EMPTY_SNOWFLAKE: SnowflakeConfig = { account: '', user: '', warehouse: '', database: '', schema: '', role: '', auth: 'pat', secret: '' };

const EXAMPLE: Settings = {
  snowflake: EMPTY_SNOWFLAKE,
  repos: {
    example: {
      grafana: {
        url: 'https://your-org.grafana.net',
        query: 'example',
        dashboards: [{ title: 'Overview', url: 'https://your-org.grafana.net/d/abc123/overview', uid: 'abc123' }],
        lokiSelector: '{app="example"}',
      },
    },
  },
};

export async function save(s: Settings) {
  await writeJson(FILE, s, { pretty: true, mode: 0o600 });
}

export async function load(): Promise<Settings> {
  const raw = await readFile(FILE, 'utf8').catch((err) => (err.code === 'ENOENT' ? null : Promise.reject(err)));
  if (raw === null) {
    await save(EXAMPLE);
    return EXAMPLE;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${FILE} is not valid JSON: ${errText(err)}`);
  }
}

export async function repoName(cwd: string) {
  const root = ROOTS.find((r) => inside(cwd, r) && cwd !== r);
  if (root) return path.relative(root, cwd).split(path.sep)[0];
  const common = (await git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']).catch(() => '')).trim();
  return path.basename(common ? path.dirname(common) : cwd);
}

async function hints(repo: string) {
  if (!/^[\w.-]+$/.test(repo) || repo.startsWith('.')) return '';
  const files = ROOTS.flatMap((r) => path.join(r, repo, 'catalog-info.yaml'));
  return (await Promise.all(files.map((f) => readFile(f, 'utf8').catch(() => '')))).join('\n');
}

const pick = (re: RegExp, s: string) => s.match(re)?.[1]?.trim();

export async function guess(repo: string, s: Settings): Promise<ObserveConfig> {
  const hint = await hints(repo);
  const others = Object.entries(s.repos ?? {}).filter(([k]) => k !== repo && k !== 'example').map(([, c]) => c);
  return {
    grafana: {
      url: others.find((c) => c.grafana?.url)?.grafana?.url ?? '',
      query: repo,
      dashboards: [],
      panels: [],
      lokiSelector: pick(/grafana\/loki-selector:\s*'?(\{[^\n']*\})/, hint) ?? `{app="${repo}"}`,
    },
  };
}

export async function configFor(repo: string, s: Settings) {
  return s.repos?.[repo] ?? (await guess(repo, s));
}

export const userServers = (cwd: string): Promise<Servers> => allowedServers(cwd);
