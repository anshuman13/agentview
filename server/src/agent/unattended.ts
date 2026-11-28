import os from 'node:os';
import path from 'node:path';
import type { UnattendedLimits } from '../settings.js';

// What a scheduled coding chat may touch: its worktree, the temp folder and the settings' extra folders and domains.
export type Unattended = { worktree: string; allowWrite: string[]; domains: string[]; denyRead: string[] };

const SECRET_DIRS = ['.ssh', '.aws', '.config/gh', '.agentview', '.claude', '.claude-alt', '.claude-alt2'];

export const unattendedRules = (worktree: string, limits: UnattendedLimits, configDirs: (string | undefined)[]): Unattended => ({
  worktree: path.resolve(worktree),
  allowWrite: limits.allowWrite,
  domains: limits.allowedDomains,
  denyRead: [...new Set([...SECRET_DIRS.map((d) => path.join(os.homedir(), d)), ...configDirs.filter((d): d is string => Boolean(d))])],
});
