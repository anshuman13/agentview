import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const home = os.homedir();
let mod: typeof import('./worktrees.js');

beforeAll(async () => {
  process.env.AGENTVIEW_ROOTS = '~/work:/srv/code';
  mod = await import('./worktrees.js');
});

describe('allowedFolder', () => {
  it('accepts folders inside a root or a Paseo worktree', () => {
    expect(mod.allowedFolder(path.join(home, 'work/tienda'))).toBe(true);
    expect(mod.allowedFolder('/srv/code/app/sub')).toBe(true);
    expect(mod.allowedFolder(path.join(home, '.paseo/worktrees/abc123'))).toBe(true);
  });

  it('rejects the roots themselves and anything outside', () => {
    expect(mod.allowedFolder(path.join(home, 'work'))).toBe(false);
    expect(mod.allowedFolder('/etc')).toBe(false);
    expect(mod.allowedFolder(home)).toBe(false);
  });

  it('does not match a sibling folder that shares the prefix', () => {
    expect(mod.allowedFolder(path.join(home, 'work-evil/repo'))).toBe(false);
    expect(mod.allowedFolder('/srv/codex/repo')).toBe(false);
  });
});

describe('parseBranch', () => {
  it('reads the branch from git status -b', () => {
    expect(mod.parseBranch('## main...origin/main [ahead 1]')).toBe('main');
    expect(mod.parseBranch('## anshuman/ast-1/slug')).toBe('anshuman/ast-1/slug');
    expect(mod.parseBranch('## No commits yet on main')).toBe('main');
  });
});
