import type http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { ROOTS, inside } from './worktrees.js';
import type { ObserveConfig, ObserveInfo, SentryIssue } from '../../shared/observe.js';

const FILE = path.join(os.homedir(), '.agentview/observe.json');
const run = promisify(execFile);

type Settings = { sentryToken?: string; repos?: Record<string, ObserveConfig> };

const EXAMPLE: Settings = {
  sentryToken: '',
  repos: {
    example: {
      grafana: {
        url: 'https://your-org.grafana.net',
        dashboards: [{ title: 'Overview', url: 'https://your-org.grafana.net/d/abc123/overview' }],
        lokiSelector: '{app="example"}',
      },
      sentry: { org: 'your-org', project: 'example', url: 'https://sentry.io' },
    },
  },
};

async function save(s: Settings) {
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(s, null, 2) + '\n', { mode: 0o600 });
}

async function load(): Promise<Settings> {
  const text = await readFile(FILE, 'utf8').catch((err) => (err.code === 'ENOENT' ? null : Promise.reject(err)));
  if (text === null) {
    await save(EXAMPLE);
    return EXAMPLE;
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${FILE} is not valid JSON: ${(err as Error).message}`);
  }
}

async function repoName(cwd: string) {
  const root = ROOTS.find((r) => inside(cwd, r) && cwd !== r);
  if (root) return path.relative(root, cwd).split(path.sep)[0];
  const common = await run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd }).then((r) => r.stdout.trim()).catch(() => '');
  return path.basename(common ? path.dirname(common) : cwd);
}

async function hints(repo: string) {
  const files = ROOTS.flatMap((r) => ['centro.yaml', 'catalog-info.yaml', '.sentryclirc', 'sentry.properties'].map((f) => path.join(r, repo, f)));
  return (await Promise.all(files.map((f) => readFile(f, 'utf8').catch(() => '')))).join('\n');
}

const pick = (text: string, re: RegExp) => text.match(re)?.[1]?.trim();

async function guess(repo: string, s: Settings): Promise<ObserveConfig> {
  const text = await hints(repo);
  const others = Object.entries(s.repos ?? {}).filter(([k]) => k !== repo && k !== 'example').map(([, c]) => c);
  const slug = pick(text, /sentry\.io\/project-slug:\s*["']?([\w./-]+)/)?.split('/');
  return {
    grafana: {
      url: others.find((c) => c.grafana?.url)?.grafana?.url ?? '',
      dashboards: [],
      lokiSelector: pick(text, /grafana\/loki-selector:\s*'?(\{[^\n']*\})/) ?? `{app="${repo}"}`,
    },
    sentry: {
      org: (slug?.length === 2 ? slug[0] : pick(text, /^\s*(?:defaults\.)?org\s*=\s*(\S+)/m)) ?? others.find((c) => c.sentry?.org)?.sentry?.org ?? '',
      project: slug?.at(-1) ?? pick(text, /^\s*(?:defaults\.)?project\s*=\s*(\S+)/m) ?? repo,
      url: others.find((c) => c.sentry?.url)?.sentry?.url ?? 'https://sentry.io',
    },
  };
}

async function info(repo: string): Promise<ObserveInfo> {
  const s = await load();
  const token = !!(process.env.SENTRY_AUTH_TOKEN || s.sentryToken);
  return { repo, config: s.repos?.[repo] ?? null, guess: await guess(repo, s), repos: Object.keys(s.repos ?? {}), file: FILE, sentryToken: token };
}

async function sentryIssues(repo: string): Promise<SentryIssue[]> {
  const s = await load();
  const sentry = s.repos?.[repo]?.sentry ?? (await guess(repo, s)).sentry;
  const token = process.env.SENTRY_AUTH_TOKEN || s.sentryToken;
  if (!token) throw new Error(`No Sentry token. Set SENTRY_AUTH_TOKEN or "sentryToken" in ${FILE}`);
  if (!sentry?.org || !sentry.project) throw new Error(`Set sentry.org and sentry.project for ${repo}`);
  const base = sentry.url ? new URL(sentry.url).origin : 'https://sentry.io';
  const url = `${base}/api/0/projects/${encodeURIComponent(sentry.org)}/${encodeURIComponent(sentry.project)}/issues/?query=is:unresolved&sort=date&limit=20`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sentry ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const list = (await res.json()) as Array<Record<string, any>>;
  return list.map((i) => ({
    id: String(i.id),
    shortId: i.shortId ?? '',
    title: i.title ?? '',
    culprit: i.culprit ?? '',
    count: Number(i.count) || 0,
    userCount: Number(i.userCount) || 0,
    lastSeen: i.lastSeen ?? '',
    permalink: i.permalink ?? '',
    level: i.level ?? '',
  }));
}

async function saveConfig(repo: string, config: unknown) {
  if (config !== null && (typeof config !== 'object' || Array.isArray(config))) throw new Error('Config must be a JSON object');
  const s = await load();
  const repos = { ...s.repos };
  if (config) repos[repo] = config as ObserveConfig;
  else delete repos[repo];
  await save({ ...s, repos });
  return info(repo);
}

export async function observe(req: http.IncomingMessage, url: URL, cwd: string) {
  if (url.pathname === '/api/observe/config' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { repo, config } = JSON.parse(body);
    if (typeof repo !== 'string' || !repo.trim()) throw new Error('Missing repo');
    return saveConfig(repo.trim(), config ?? null);
  }
  const repo = url.searchParams.get('repo')?.trim() || (await repoName(cwd));
  if (url.pathname === '/api/observe/sentry/issues') return sentryIssues(repo);
  if (url.pathname === '/api/observe') return info(repo);
  throw new Error('Not found');
}
