import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { listSessions } from '../agent/claude/sessions.js';
import { STALE_MS, type Repo, type RepoKind, type Worktree } from '../../../shared/protocol.js';
import { inside } from '../../../shared/util.js';
import { ROOTS } from './files.js';
import { defaultBase, mainCheckout, safeGit } from './git.js';
import { exec as run } from '../exec.js';

const paseoMissing = (err: unknown) => (err as { code?: string }).code === 'ENOENT' || /Executable not found|paseo is not installed/.test((err as Error)?.message ?? '');
const notInstalled = (err: unknown): never => { throw paseoMissing(err) ? new Error('paseo is not installed') : err; };
const paseo = (args: string[], timeout: number) => run('paseo', args, { timeout });
const git = async (cwd: string, ...args: string[]) => (await run('git', ['-C', cwd, ...args])).stdout.trim();

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

const REPOS_TTL = 10_000;
let reposMemo: { at: number; value: Promise<Repo[]> } | null = null;

// One listing is shared by calls within 10 s, and by calls that arrive while it runs. A failed one is not kept.
export function listRepos(): Promise<Repo[]> {
  if (reposMemo && Date.now() - reposMemo.at < REPOS_TTL) return reposMemo.value;
  const value = scanRepos();
  const memo = (reposMemo = { at: Date.now(), value });
  value.catch(() => reposMemo === memo && (reposMemo = null));
  return value;
}

async function scanRepos(): Promise<Repo[]> {
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
  reposMemo = null;
  return dir;
}

// A worktree can go once nothing has it open and it is idle, or once its PR has merged and nothing is left uncommitted.
export const canRemove = (w: { open: boolean; dirty: number; lastActive: number; merged?: number }, now = Date.now()) =>
  !w.open && (now - w.lastActive > STALE_MS || Boolean(w.merged && !w.dirty));

// A merged PR stays merged, so a found one is kept; a branch with none is asked again after 10 minutes.
const merged = new Map<string, { n: number | undefined; at: number }>();
const NOT_MERGED_MS = 10 * 60_000;

async function mergedPr(cwd: string) {
  const branch = await git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD').catch(() => 'HEAD');
  if (branch === 'HEAD') return undefined;
  const k = `${cwd}\0${branch}`;
  const hit = merged.get(k);
  if (hit && (hit.n !== undefined || Date.now() - hit.at < NOT_MERGED_MS)) return hit.n;
  const { stdout } = await run('gh', ['pr', 'list', '--head', branch, '--state', 'merged', '--json', 'number', '--limit', '1'], { cwd, timeout: 15_000 }).catch(() => ({ stdout: '[]' }));
  const n = (JSON.parse(stdout || '[]') as Array<{ number: number }>)[0]?.number;
  merged.set(k, { n, at: Date.now() });
  if (merged.size > 500) merged.delete(merged.keys().next().value!);
  return n;
}

type Space = { id: string; project: string; repo: string; name: string; cwd: string };

async function paseoSpaces(): Promise<Space[]> {
  const listed = await Promise.all([paseo(['workspace', 'ls', '--json'], 30_000), paseoProjects()]).catch((err) => { if (paseoMissing(err)) return null; throw err; });
  if (!listed) return [];
  const [{ stdout }, projects] = listed;
  return (JSON.parse(stdout) as Array<{ workspaceId: string; project: string; name: string; isolation: string; cwd: string }>)
    .filter((w) => w.isolation === 'worktree')
    .map((w) => ({ id: w.workspaceId, project: w.project, repo: projects.find((p) => p.name === w.project || p.projectId === w.project)?.path ?? '', name: w.name, cwd: w.cwd }));
}

// /tries without Paseo leaves plain git worktrees in a hidden .tries folder in each root; a clean one can go at once.
async function triesSpaces(): Promise<Space[]> {
  const dirs = await Promise.all(ROOTS.map(async (root) => (await readdir(path.join(root, '.tries'), { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory()).map((d) => path.join(root, '.tries', d.name))));
  const spaces = await Promise.all(dirs.flat().map(async (cwd) => {
    const repo = await mainCheckout(cwd).catch(() => '');
    const name = await git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD').catch(() => '');
    return repo && repo !== cwd ? { id: `git:${cwd}`, project: path.basename(repo), repo, name: name || path.basename(cwd), cwd } : null;
  }));
  return spaces.filter((w): w is Space => w !== null);
}

export async function listWorktrees(openCwds: string[]): Promise<Worktree[]> {
  const spaces = [...(await paseoSpaces()), ...(await triesSpaces())];
  if (!spaces.length) return [];
  const chats = await listSessions({ limit: 1000 });
  return Promise.all(
    spaces.map(async (w) => {
      const lastCommit = Number(await git(w.cwd, 'log', '-1', '--format=%ct').catch(() => '0')) * 1000;
      const dirty = (await git(w.cwd, 'status', '--porcelain').catch(() => '')).split('\n').filter(Boolean).map((l) => l.slice(3).split(' -> ').pop()!);
      const edits = await Promise.all(dirty.map((f) => stat(path.join(w.cwd, f)).then((s) => s.mtimeMs).catch(() => 0)));
      const lastChat = chats.filter((c) => c.cwd && inside(c.cwd, w.cwd)).map((c) => c.lastModified);
      const lastActive = Math.max(lastCommit, ...lastChat, ...edits);
      const open = openCwds.some((c) => inside(c, w.cwd));
      const merged = dirty.length ? undefined : await mergedPr(w.cwd);
      return { ...w, dirty: dirty.length, lastActive, merged, removable: canRemove({ open, dirty: dirty.length, lastActive, merged }) || (w.id.startsWith('git:') && !open && !dirty.length) };
    }),
  );
}

export async function removeWorktree(id: string, openCwds: string[]) {
  const w = (await listWorktrees(openCwds)).find((x) => x.id === id);
  if (!w) throw new Error('Worktree not found');
  if (!w.removable) throw new Error('This worktree is open, has uncommitted changes, or was used in the last 12 hours and its PR has not merged');
  if (id.startsWith('git:')) await git(w.repo, 'worktree', 'remove', w.cwd);
  else await paseo(['workspace', 'archive', id], 60_000).catch(notInstalled);
}

// A job run's worktree and its local branch: a Paseo workspace is archived, a git worktree removed even with changes in it.
export async function removeRunWorktree(run: { repo?: string; worktree?: string; branch?: string; paseo?: boolean }) {
  const { repo, worktree, branch } = run;
  if (!repo || !worktree || !branch) throw new Error('The run has no worktree');
  // A folder already gone (let go, or removed by hand) only leaves git's record and the branch.
  if (!existsSync(worktree)) await safeGit(repo, ['worktree', 'prune']).catch(() => {});
  else if (run.paseo) {
    const id = (await paseoSpaces()).find((w) => w.cwd === worktree)?.id;
    if (id) await paseo(['workspace', 'archive', id], 60_000).catch(notInstalled);
  } else await safeGit(repo, ['worktree', 'remove', '--force', worktree]);
  await safeGit(repo, ['branch', '-D', branch]).catch(() => {});
}

async function paseoProjects() {
  const { stdout } = await paseo(['project', 'ls', '--json'], 30_000).catch(notInstalled);
  return JSON.parse(stdout) as Array<{ projectId: string; name: string; path: string }>;
}

export async function createWorktree(repo: string, branch: string) {
  if (!(await paseoProjects()).some((p) => p.path === repo)) throw new Error('This repo is not a Paseo project');
  if (branch.startsWith('-') || !/^[\w./-]+$/.test(branch)) throw new Error('Invalid branch name');
  await git(repo, 'check-ref-format', '--branch', branch).catch(() => { throw new Error(`Invalid branch name: ${branch}`); });
  const base = (await defaultBase(repo)).replace(/^origin\//, '');
  const { stdout } = await paseo(['workspace', 'create', '--isolation', 'worktree', '--path', repo, '--mode', 'branch-off', '--new-branch', branch, '--base', base, '--json'], 300_000).catch(notInstalled);
  const out = JSON.parse(stdout);
  const cwd: string | undefined = out.cwd ?? out.workspace?.cwd;
  if (cwd) return cwd;
  const id = out.workspaceId ?? out.workspace?.workspaceId;
  const spaces = JSON.parse((await paseo(['workspace', 'ls', '--json'], 30_000)).stdout) as Array<{ workspaceId: string; cwd: string }>;
  const made = spaces.find((w) => w.workspaceId === id);
  if (!made) throw new Error('Paseo created the worktree but did not report its folder');
  return made.cwd;
}
