import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error) => void) => cb(Object.assign(new Error('Executable not found in $PATH: "paseo"'), { code: 'ENOENT' })),
}));

const home = os.homedir();
let mod: typeof import('./worktrees.js');
let files: typeof import('./files.js');

beforeAll(async () => {
  process.env.AGENTVIEW_ROOTS = '~/work:/srv/code';
  mod = await import('./worktrees.js');
  files = await import('./files.js');
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
    expect(mod.parseBranch('## anshuman/ast-1/slug')).toBe('anshuman/ast-1/slug');
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
