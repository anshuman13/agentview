import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listSessions } from '@anthropic-ai/claude-agent-sdk';
import { STALE_MS, type Repo, type Worktree } from '../../shared/protocol.js';

const run = promisify(execFile);
const git = async (cwd: string, ...args: string[]) => (await run('git', ['-C', cwd, ...args])).stdout.trim();
export const inside = (cwd: string, dir: string) => cwd === dir || cwd.startsWith(dir + '/');

const home = os.homedir();
export const ROOTS = (process.env.AGENTVIEW_ROOTS ?? '~/workspace:~/workspace_personal').split(':').filter(Boolean).map((r) => path.resolve(r.replace(/^~/, home)));
const PASEO_TREES = path.join(home, '.paseo/worktrees');

export const allowedFolder = (dir: string) => [...ROOTS, PASEO_TREES].some((r) => inside(dir, r) && dir !== r);

export const parseBranch = (head: string) => head.replace(/^## (No commits yet on )?/, '').split('...')[0];

export async function listRepos(): Promise<Repo[]> {
  const paseo = (await paseoProjects().catch(() => [])).map((p) => p.path);
  const dirs = await Promise.all(ROOTS.map(async (root) => (await readdir(root, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory()).map((d) => path.join(root, d.name))));
  const repos = await Promise.all(
    dirs.flat().map(async (cwd) => {
      const status = await git(cwd, 'status', '--porcelain', '-b').catch(() => null);
      if (status === null) return null;
      const [head, ...files] = status.split('\n');
      const branch = parseBranch(head);
      const lastCommit = Number(await git(cwd, 'log', '-1', '--format=%ct').catch(() => '0')) * 1000;
      return { name: path.basename(cwd), root: path.basename(path.dirname(cwd)), cwd, branch, dirty: files.filter(Boolean).length, lastCommit, paseo: paseo.includes(cwd) };
    }),
  );
  return repos.filter((r) => r !== null);
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

export async function paseoProjects() {
  const { stdout } = await run('paseo', ['project', 'ls', '--json']);
  return JSON.parse(stdout) as Array<{ projectId: string; name: string; path: string }>;
}

export async function createWorktree(repo: string, branch: string) {
  if (!(await paseoProjects()).some((p) => p.path === repo)) throw new Error('This repo is not a Paseo project');
  if (branch.startsWith('-')) throw new Error('Invalid branch name');
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
