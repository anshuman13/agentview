import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { DeployEnv, DeployJob, DeployRecord, DeployStatus } from '../../../shared/protocol.js';

const exec = promisify(execFile);
const VELODROME = 'https://velodrome.prod.nube.tech';
const FINAL = ['success', 'failure', 'error', 'inactive'];

type App = { project: string; dir: string; envs: { name: string; defaultBranchOnly: boolean }[] };
type Node = {
  databaseId: number;
  commitOid: string;
  ref: { name: string } | null;
  createdAt: string;
  creator: { login: string } | null;
  latestStatus: { state: string; description: string | null; logUrl: string | null } | null;
};
type Status = { id: number; state: string; description: string | null; log_url: string | null; created_at: string };

async function run(cmd: string, args: string[], cwd: string, input = '') {
  try {
    const p = exec(cmd, args, { cwd, timeout: 20_000, maxBuffer: 16 * 1024 * 1024 });
    p.child.stdin?.end(input);
    return (await p).stdout.trim();
  } catch (err) {
    const e = err as { code?: string | number; killed?: boolean; stderr?: string; message: string };
    if (e.code === 'ENOENT') throw new Error(`${cmd} is not installed`);
    if (e.killed) throw new Error(`${cmd} ${args[0]} timed out after 20s`);
    throw new Error(e.stderr?.trim() || e.message);
  }
}

export function parseApp(text: string) {
  const project = text.match(/^project:\s*["']?([\w.-]+)/m)?.[1];
  const envs: App['envs'] = [];
  const block = text.split(/^environments:\s*$/m)[1]?.split(/^[a-z_]+:/m)[0] ?? '';
  for (const line of block.split('\n')) {
    const name = line.match(/^\s*-\s*name:\s*["']?([^"'\s#]+)/)?.[1];
    if (name) envs.push({ name, defaultBranchOnly: false });
    else if (/^\s*default_branch_only:\s*true/.test(line) && envs.length) envs[envs.length - 1].defaultBranchOnly = true;
  }
  return project ? { project, envs } : null;
}

const subdirs = async (dir: string) =>
  (await readdir(dir, { withFileTypes: true }).catch(() => []))
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
    .map((d) => path.join(dir, d.name));

async function findApps(root: string) {
  const level1 = await subdirs(root);
  const level2 = (await Promise.all(level1.map(subdirs))).flat();
  const apps = await Promise.all([root, ...level1, ...level2].map(async (dir) => {
    for (const f of ['app.yaml', 'app.yml']) {
      const app = parseApp((await readFile(path.join(dir, '.deploy', f), 'utf8').catch(() => '')));
      if (app) return { ...app, dir };
    }
    return null;
  }));
  return apps.filter((a): a is App => a !== null);
}

async function context(cwd: string, want: string | null) {
  const root = await run('git', ['rev-parse', '--show-toplevel'], cwd).catch(() => {
    throw new Error('This chat is not in a git repo');
  });
  const apps = await findApps(root);
  if (!apps.length) throw new Error(`${path.basename(root)} has no Velo app (no .deploy/app.yaml)`);
  const score = (a: App) => (cwd === a.dir || cwd.startsWith(a.dir + '/') ? a.dir.length : 0);
  apps.sort((a, b) => score(b) - score(a));
  const app = apps.find((a) => a.project === want) ?? apps[0];
  if (!app.envs.length) throw new Error(`${app.project} lists no environments in .deploy/app.yaml`);
  const remote = await run('git', ['remote', 'get-url', 'origin'], root).catch(() => '');
  const repo = remote.match(/github\.com[:/]([^/]+\/[^/]+?)(\.git)?$/)?.[1];
  if (!repo) throw new Error('The repo has no GitHub origin remote, which Velodrome deploys from');
  return { apps, app, repo };
}

const deploymentUrl = (repo: string, project: string, id: number) => `${VELODROME}/repo/${repo.split('/')[1]}/project/${project}/deployments/${id}`;

const record = (n: Node, repo: string, project: string): DeployRecord => ({
  id: n.databaseId,
  sha: n.commitOid,
  ref: n.ref?.name ?? '',
  state: (n.latestStatus?.state ?? 'pending').toLowerCase(),
  description: n.latestStatus?.description ?? '',
  at: n.createdAt,
  by: n.creator?.login ?? '',
  url: n.latestStatus?.logUrl || deploymentUrl(repo, project, n.databaseId),
});

export function summarize(name: string, project: string, defaultBranchOnly: boolean, history: DeployRecord[]): DeployEnv {
  const i = history.findIndex((d) => d.state === 'success');
  const deployed = history[i] ?? null;
  const rollbackTo = deployed ? history.slice(i + 1).find((d) => d.sha !== deployed.sha && ['success', 'inactive'].includes(d.state)) ?? null : null;
  return { name, label: name.replace(`${project}/`, ''), defaultBranchOnly, deployed, latest: history[0] ?? null, rollbackTo, history };
}

async function history(cwd: string, repo: string, envs: string[]) {
  const [owner, name] = repo.split('/');
  const fields = 'databaseId commitOid ref { name } createdAt creator { login } latestStatus { state description logUrl }';
  const parts = envs.map((e, i) => `e${i}: deployments(environments: [${JSON.stringify(e)}], first: 10, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { ${fields} } }`);
  const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${parts.join(' ')} } }`;
  const out = JSON.parse(await run('gh', ['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `name=${name}`], cwd));
  return envs.map((_, i) => out.data.repository[`e${i}`].nodes as Node[]);
}

async function deployStatus(cwd: string, want: string | null): Promise<DeployStatus> {
  const { apps, app, repo } = await context(cwd, want);
  const [sha, branch, nodes] = await Promise.all([
    run('git', ['rev-parse', 'HEAD'], cwd),
    run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd),
    history(cwd, repo, app.envs.map((e) => e.name)),
  ]);
  return {
    apps: apps.map((a) => a.project),
    app: app.project,
    repo,
    velodrome: `${VELODROME}/repo/${repo.split('/')[1]}/project/${app.project}`,
    head: { sha, branch },
    envs: app.envs.map((e, i) => summarize(e.name, app.project, e.defaultBranchOnly, nodes[i].map((n) => record(n, repo, app.project)))),
  };
}

// Status for the background inbox: null when the repo has no Velo app, so the poll skips it quietly.
export async function deployWatch(cwd: string) {
  const apps = await findApps(await run('git', ['rev-parse', '--show-toplevel'], cwd).catch(() => cwd)).catch(() => []);
  return apps.length ? deployStatus(cwd, null) : null;
}

const jobs = new Map<string, DeployJob>();

export async function follow(cwd: string, repo: string, id: number, job: DeployJob) {
  const seen = new Set<number>();
  const until = Date.now() + 60 * 60_000;
  try {
    while (!job.done && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 5000));
      const statuses: unknown = await run('gh', ['api', `repos/${repo}/deployments/${id}/statuses?per_page=100`], cwd)
        .then(JSON.parse)
        .catch((err: Error) => (job.lines.push(err.message), []));
      if (!Array.isArray(statuses)) throw new Error('GitHub returned an unexpected deployment status');
      for (const s of (statuses as Status[]).reverse()) {
        if (seen.has(s.id)) continue;
        seen.add(s.id);
        job.lines.push(`${new Date(s.created_at).toLocaleTimeString()} ${s.state}${s.description ? `: ${s.description}` : ''}`);
        if (s.log_url) job.url = s.log_url;
        if (FINAL.includes(s.state)) Object.assign(job, { done: true, ok: s.state === 'success' });
      }
    }
    if (!job.done) Object.assign(job, { done: true, lines: [...job.lines, 'Stopped following after an hour, see Velodrome'] });
  } finally {
    setTimeout(() => jobs.delete(job.id), 60 * 60_000);
  }
}

async function start(cwd: string, repo: string, project: string, env: string, sha: string, label: string) {
  const body = { ref: sha, environment: env, required_contexts: [], auto_merge: false, payload: { velo_project: project, branch: null } };
  const created = JSON.parse(await run('gh', ['api', '-X', 'POST', `repos/${repo}/deployments`, '--input', '-'], cwd, JSON.stringify(body)));
  if (!created.id) throw new Error(created.message ?? 'GitHub did not create the deployment');
  const job: DeployJob = {
    id: randomUUID(),
    lines: [`Created deployment ${created.id}: ${created.sha.slice(0, 8)} (${label}) to ${env}`, 'Waiting for Velodrome...'],
    done: false,
    ok: false,
    url: deploymentUrl(repo, project, created.id),
  };
  jobs.set(job.id, job);
  follow(cwd, repo, created.id, job).catch((err: Error) => {
    Object.assign(job, { done: true, ok: false, lines: [...job.lines, err.message] });
  });
  return job;
}

async function runDeploy(cwd: string, body: Record<string, unknown>) {
  const { app, repo } = await context(cwd, String(body.app ?? ''));
  const env = app.envs.find((e) => e.name === body.env);
  if (!env) throw new Error(`Unknown environment: ${String(body.env)}`);
  const ref = String(body.ref ?? '').trim();
  if (!ref || ref.startsWith('-')) throw new Error('No branch or commit given');
  const sha = await run('git', ['rev-parse', '--verify', '--quiet', `origin/${ref}^{commit}`], cwd)
    .catch(() => run('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd))
    .catch(() => ref);
  return start(cwd, repo, app.project, env.name, sha, ref);
}

async function rollback(cwd: string, body: Record<string, unknown>) {
  const status = await deployStatus(cwd, String(body.app ?? ''));
  const env = status.envs.find((e) => e.name === body.env);
  if (!env?.deployed || !env.rollbackTo) throw new Error('No earlier successful deploy to roll back to');
  if (body.sha !== env.rollbackTo.sha) throw new Error('The deploy history changed, refresh and try again');
  return start(cwd, status.repo, status.app, env.name, env.rollbackTo.sha, `rollback from ${env.deployed.sha.slice(0, 8)}`);
}

export async function deployRoute(cwd: string, method: string, url: URL, body: () => Promise<string>) {
  const route = url.pathname.slice('/api/deploy/'.length);
  if (route === 'status') return deployStatus(cwd, url.searchParams.get('app'));
  if (route.startsWith('job/')) {
    const job = jobs.get(route.slice(4));
    if (!job) throw new Error('Deploy job not found');
    return job;
  }
  if (method !== 'POST') throw new Error(`Unknown deploy route: ${route}`);
  const data = JSON.parse(await body());
  if (route === 'run') return runDeploy(cwd, data);
  if (route === 'rollback') return rollback(cwd, data);
  throw new Error(`Unknown deploy route: ${route}`);
}
