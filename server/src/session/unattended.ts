import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
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

const gitDir = (u: Unattended) => path.join(u.worktree, '.git');

export const sandboxOf = (u: Unattended) => ({
  enabled: true,
  failIfUnavailable: true,
  autoAllowBashIfSandboxed: true,
  allowUnsandboxedCommands: false,
  filesystem: { allowWrite: [u.worktree, os.tmpdir(), ...u.allowWrite], denyWrite: [gitDir(u)], denyRead: u.denyRead },
  network: { allowedDomains: u.domains },
});

// The path with links followed, also when the file does not exist yet: the nearest folder that exists is resolved.
function real(file: string): string {
  try {
    return realpathSync(file);
  } catch {
    const parent = path.dirname(file);
    return parent === file ? file : path.join(real(parent), path.basename(file));
  }
}

const inside = (dir: string, file: string) => file === dir || file.startsWith(dir + path.sep);

export function editDenied(file: string, u: Unattended): string | null {
  const target = real(path.resolve(u.worktree, file));
  const allowed = [u.worktree, os.tmpdir(), ...u.allowWrite].some((d) => inside(real(d), target));
  return allowed && !inside(real(gitDir(u)), target) ? null : 'This unattended run may only edit files in its worktree';
}

export function toolDenied(tool: string, input: Record<string, unknown>, u: Unattended): string | null {
  if (tool === 'WebFetch') {
    let host = '';
    try {
      host = new URL(String(input.url ?? '')).hostname.toLowerCase();
    } catch {}
    const listed = u.domains.some((d) => host === d || host.endsWith(`.${d}`));
    return listed ? null : `This unattended run may only fetch ${u.domains.join(', ')}`;
  }
  return tool.startsWith('mcp__') && !tool.startsWith('mcp__agentview__') ? 'This unattended run may only use the agentview tools' : null;
}

export const denyTool = (reason: string): HookJSONOutput => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
