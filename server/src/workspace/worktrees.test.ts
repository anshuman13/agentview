import { mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'bun:test';

const realExec = await import('../exec.js').then((m) => ({ ...m }));

vi.mock('../exec.js', () => ({
  ...realExec,
  exec: async () => {
    throw Object.assign(new Error('Executable not found in $PATH: "paseo"'), { code: 'ENOENT' });
  },
}));

const home = os.homedir();
let mod: typeof import('./worktrees.js');
let files: typeof import('./files.js');

beforeAll(async () => {
  process.env.AGENTVIEW_ROOTS = '~/work:/srv/code';
  mod = await import('./worktrees.js');
  files = await import('./files.js');
});

describe('isWorkspaceRepo', () => {
  it('accepts a git checkout directly in a root and nothing deeper, hidden or without .git', () => {
    for (const name of ['shop/.git', 'notes', '.tries/shop-x/.git', 'shop/sub/.git']) mkdirSync(path.join(home, 'work', name), { recursive: true });
    expect(mod.isWorkspaceRepo(path.join(home, 'work/shop'))).toBe(true);
    expect(mod.isWorkspaceRepo(path.join(home, 'work/notes'))).toBe(false);
    expect(mod.isWorkspaceRepo(path.join(home, 'work/.tries/shop-x'))).toBe(false);
    expect(mod.isWorkspaceRepo(path.join(home, 'work/shop/sub'))).toBe(false);
    rmSync(path.join(home, 'work'), { recursive: true, force: true });
  });
});

describe('allowedFolder', () => {
  it('accepts folders inside a root or a Paseo worktree', () => {
    expect(files.allowedFolder(path.join(home, 'work/shop'))).toBe(true);
    expect(files.allowedFolder('/srv/code/app/sub')).toBe(true);
    expect(files.allowedFolder(path.join(home, '.paseo/worktrees/abc123'))).toBe(true);
  });

  it('rejects the roots themselves and anything outside', () => {
    expect(files.allowedFolder(path.join(home, 'work'))).toBe(false);
    expect(files.allowedFolder('/etc')).toBe(false);
    expect(files.allowedFolder(home)).toBe(false);
  });

  it('does not match a sibling folder that shares the prefix', () => {
    expect(files.allowedFolder(path.join(home, 'work-evil/repo'))).toBe(false);
    expect(files.allowedFolder('/srv/codex/repo')).toBe(false);
  });
});

describe('parseBranch', () => {
  it('reads the branch from git status -b', () => {
    expect(mod.parseBranch('## main...origin/main [ahead 1]')).toBe('main');
    expect(mod.parseBranch('## dev/ast-1/slug')).toBe('dev/ast-1/slug');
    expect(mod.parseBranch('## No commits yet on main')).toBe('main');
  });
});

describe('repoKind', () => {
  it('detects the kind of repo from its root files', () => {
    expect(mod.repoKind(['package.json', 'src'], '{"dependencies":{"react":"18"}}')).toBe('web');
    expect(mod.repoKind(['pyproject.toml', 'app'])).toBe('service');
    expect(mod.repoKind(['main.tf', 'README.md'])).toBe('infra');
    expect(mod.repoKind(['dbt_project.yml', 'models'])).toBe('data');
    expect(mod.repoKind(['Cargo.toml', 'src-tauri'])).toBe('app');
    expect(mod.repoKind(['README.md', 'guide.md', 'notes.md'])).toBe('docs');
    expect(mod.repoKind(['Makefile'])).toBe('other');
  });
});

describe('createFolder', () => {
  it('rejects unknown workspaces and names that leave the workspace', async () => {
    await expect(mod.createFolder('elsewhere', 'x')).rejects.toThrow('Unknown workspace');
    await expect(mod.createFolder('work', '../evil')).rejects.toThrow('Use letters');
    await expect(mod.createFolder('work', 'a/b')).rejects.toThrow('Use letters');
    await expect(mod.createFolder('work', '.hidden')).rejects.toThrow('Use letters');
  });
});

describe('paseo missing', () => {
  it('fails creating a worktree with a clear message', async () => {
    await expect(mod.createWorktree('/repo', 'main')).rejects.toThrow('paseo is not installed');
  });
});

describe('canRemove', () => {
  const now = 100 * 3600_000;
  it('waits 12 idle hours unless the PR merged and nothing is uncommitted', () => {
    expect(mod.canRemove({ open: false, dirty: 0, lastActive: now - 1000 }, now)).toBe(false);
    expect(mod.canRemove({ open: false, dirty: 0, lastActive: now - 1000, merged: 7 }, now)).toBe(true);
    expect(mod.canRemove({ open: false, dirty: 2, lastActive: now - 1000, merged: 7 }, now)).toBe(false);
    expect(mod.canRemove({ open: true, dirty: 0, lastActive: 0, merged: 7 }, now)).toBe(false);
    expect(mod.canRemove({ open: false, dirty: 3, lastActive: 0 }, now)).toBe(true);
  });
});
