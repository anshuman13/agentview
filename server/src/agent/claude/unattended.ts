import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HookJSONOutput } from './sdkTypes.js';
import { ACCOUNT_LABEL, type Account } from '../../../../shared/protocol.js';
import type { UnattendedLimits } from '../../settings.js';
import { inside } from '../../../../shared/util.js';
import { unattendedRules, type Unattended } from '../unattended.js';
import { configDir } from './accounts.js';

// The rules for a Claude chat, which may not read any account's config folder either.
export const claudeRules = (worktree: string, limits: UnattendedLimits) => unattendedRules(worktree, limits, Object.keys(ACCOUNT_LABEL).map((a) => configDir(a as Account)));

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


export function editDenied(file: string, u: Unattended): string | null {
  const target = real(path.resolve(u.worktree, file));
  const allowed = [u.worktree, os.tmpdir(), ...u.allowWrite].some((d) => inside(target, real(d)));
  return allowed && !inside(target, real(gitDir(u))) ? null : 'This unattended run may only edit files in its worktree';
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
  if (tool === 'ListMcpResourcesTool' || tool === 'ReadMcpResourceTool') return 'This unattended run may only use the agentview tools';
  return tool.startsWith('mcp__') && !tool.startsWith('mcp__agentview__') ? 'This unattended run may only use the agentview tools' : null;
}

export const denyTool = (reason: string): HookJSONOutput => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
