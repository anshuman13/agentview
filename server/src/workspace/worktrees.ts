import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listSessions } from '../agent/claude/sessions.js';
import { STALE_MS, type Repo, type RepoKind, type Worktree } from '../../../shared/protocol.js';

const run = promisify(execFile);
const git = async (cwd: string, ...args: string[]) => (await run('git', ['-C', cwd, ...args])).stdout.trim();
export const inside = (cwd: string, dir: string) => cwd === dir || cwd.startsWith(dir + '/');

const home = os.homedir();
export const ROOTS = (process.env.AGENTVIEW_ROOTS ?? '~/workspace:~/workspace_personal').split(':').filter(Boolean).map((r) => path.resolve(r.replace(/^~/, home)));
const PASEO_TREES = path.join(home, '.paseo/worktrees');

export const allowedFolder = (dir: string) => [...ROOTS, PASEO_TREES].some((r) => inside(dir, r) && dir !== r);

export const parseBranch = (head: string) => head.replace(/^## (No commits yet on )?/, '').split('...')[0];

export function repoKind(names: string[], pkg = '', name = ''): RepoKind {
  const has = (n: string) => names.includes(n);
  if (has('src-tauri') || has('android') || has('ios') || (has('Cargo.toml') && has('app'))) return 'app';
  if (has('dbt_project.yml') || /dbt/.test(name)) return 'data';
  if (names.some((n) => n.endsWith('.tf')) || has('Pulumi.yaml') || has('helm') || /terraform|infra/.test(name)) return 'infra';
  if (/"(react|vite|next|vue|svelte)"/.test(pkg)) return 'web';
  if (has('pyproject.toml') || has('requirements.txt') || has('go.mod') || has('package.json') || has('Cargo.toml')) return 'service';
  const files = names.filter((n) => n.includes('.') && !n.startsWith('.'));
  if (files.length && files.filter((n) => n.endsWith('.md')).length * 2 >= files.length) return 'docs';
  return 'other';
}

const pkgOf = (dir: string, names: string[]) => (names.includes('package.json') ? readFile(path.join(dir, 'package.json'), 'utf8').catch(() => '') : Promise.resolve(''));

const detectKind = async (cwd: string) => {
  const top = await readdir(cwd, { withFileTypes: true }).catch(() => []);
  const names = top.map((d) => d.name);
  if (!names.some((n) => !n.startsWith('.'))) return 'new';
  const kind = repoKind(names, await pkgOf(cwd, names), path.basename(cwd));
  const weak = kind === 'docs' || kind === 'other' || (kind === 'service' && !['pyproject.toml', 'requirements.txt', 'go.mod', 'Cargo.toml'].some((n) => names.includes(n)));
  if (!weak) return kind;
  const subs = top.filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules').slice(0, 12).map((d) => path.join(cwd, d.name));
  const deep = await Promise.all(subs.map(async (d) => { const n = await readdir(d).catch(() => [] as string[]); return { n, pkg: await pkgOf(d, n) }; }));
  const inner = repoKind(deep.flatMap((d) => d.n), deep.map((d) => d.pkg).join('\n'));
  return inner === 'docs' || inner === 'other' ? kind : inner;
};

export async function listRepos(): Promise<Repo[]> {
  const paseo = (await paseoProjects().catch(() => [])).map((p) => p.path);
  const dirs = await Promise.all(ROOTS.map(async (root) => (await readdir(root, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => path.join(root, d.name))));
  const repos = await Promise.all(
    dirs.flat().map(async (cwd) => {
      const status = await git(cwd, 'status', '--porcelain', '-b').catch(() => null);
      const base = { name: path.basename(cwd), root: path.basename(path.dirname(cwd)), kind: await detectKind(cwd), cwd, paseo: paseo.includes(cwd) };
      if (status === null) return { ...base, branch: '', dirty: 0, lastCommit: (await stat(cwd).catch(() => null))?.mtimeMs ?? 0 };
      const [head, ...files] = status.split('\n');
      const branch = parseBranch(head);
      const lastCommit = Number(await git(cwd, 'log', '-1', '--format=%ct').catch(() => '0')) * 1000;
      return { ...base, branch, dirty: files.filter(Boolean).length, lastCommit };
    }),
  );
  return repos;
}

export async function createFolder(root: string, name: string) {
  const base = ROOTS.find((r) => path.basename(r) === root);
  if (!base) throw new Error(`Unknown workspace: ${root}`);
  if (!/^[A-Za-z0-9][\w.-]*$/.test(name)) throw new Error('Use letters, numbers, dots, dashes and underscores');
  const dir = path.join(base, name);
  await mkdir(dir).catch((err) => { throw new Error(err.code === 'EEXIST' ? `${name} already exists` : err.message); });
  await git(dir, 'init', '-b', 'main');
  return dir;
}

export async function listWorktrees(openCwds: string[]): Promise<Worktree[]> {
  const [{ stdout }, projects] = await Promise.all([run('paseo', ['workspace', 'ls', '--json']), paseoProjects()]);
  const spaces = (JSON.parse(stdout) as Array<{ workspaceId: string; project: string; name: string; isolation: string; cwd: string }>)
    .filter((w) => w.isolation === 'worktree');
  const chats = await listSessions({ limit: 1000 });
  return Promise.all(
    spaces.map(async (w) => {
      const lastCommit = Number(await git(w.cwd, 'log', '-1', '--format=%ct').catch(() => '0')) * 1000;
      const dirty = (await git(w.cwd, 'status', '--porcelain').catch(() => '')).split('\n').filter(Boolean).map((l) => l.slice(3).split(' -> ').pop()!);
      const edits = await Promise.all(dirty.map((f) => stat(path.join(w.cwd, f)).then((s) => s.mtimeMs).catch(() => 0)));
      const lastChat = chats.filter((c) => c.cwd && inside(c.cwd, w.cwd)).map((c) => c.lastModified);
      const lastActive = Math.max(lastCommit, ...lastChat, ...edits);
      const open = openCwds.some((c) => inside(c, w.cwd));
      return { id: w.workspaceId, project: w.project, repo: projects.find((p) => p.name === w.project || p.projectId === w.project)?.path ?? '', name: w.name, cwd: w.cwd, dirty: dirty.length, lastActive, removable: !open && Date.now() - lastActive > STALE_MS };
    }),
  );
}

export async function removeWorktree(id: string, openCwds: string[]) {
  const w = (await listWorktrees(openCwds)).find((x) => x.id === id);
  if (!w) throw new Error('Worktree not found');
  if (!w.removable) throw new Error('This worktree was used in the last 12 hours or is open');
  await run('paseo', ['workspace', 'archive', id]);
}

async function paseoProjects() {
  const { stdout } = await run('paseo', ['project', 'ls', '--json']);
  return JSON.parse(stdout) as Array<{ projectId: string; name: string; path: string }>;
}

export async function createWorktree(repo: string, branch: string) {
  if (!(await paseoProjects()).some((p) => p.path === repo)) throw new Error('This repo is not a Paseo project');
  if (branch.startsWith('-') || !/^[\w./-]+$/.test(branch)) throw new Error('Invalid branch name');
  await git(repo, 'check-ref-format', '--branch', branch).catch(() => { throw new Error(`Invalid branch name: ${branch}`); });
  const base = (await git(repo, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD').catch(() => 'origin/main')).replace(/^origin\//, '');
  const { stdout } = await run('paseo', ['workspace', 'create', '--isolation', 'worktree', '--path', repo, '--mode', 'branch-off', '--new-branch', branch, '--base', base, '--json'], { timeout: 300_000 });
  const out = JSON.parse(stdout);
  const cwd: string | undefined = out.cwd ?? out.workspace?.cwd;
  if (cwd) return cwd;
  const id = out.workspaceId ?? out.workspace?.workspaceId;
  const spaces = JSON.parse((await run('paseo', ['workspace', 'ls', '--json'])).stdout) as Array<{ workspaceId: string; cwd: string }>;
  const made = spaces.find((w) => w.workspaceId === id);
  if (!made) throw new Error('Paseo created the worktree but did not report its folder');
  return made.cwd;
}
