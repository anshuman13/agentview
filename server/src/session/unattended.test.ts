import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { HookInput } from '@anthropic-ai/claude-agent-sdk';
import { ToolHooks } from '../agent/claude/toolHooks.js';
import { UNATTENDED_DOMAINS, unattendedLimits } from '../settings.js';
import { unattendedRules } from './unattended.js';

const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'unattended-')));
// The temp folder is writable, so the folder the edits must not reach is made outside it.
const outside = realpathSync(mkdtempSync(path.join(process.cwd(), '.unattended-')));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('unattendedLimits', () => {
  it('uses the defaults without a key, and falls back with one log line for a bad value', () => {
    const log = vi.fn();
    expect(unattendedLimits(undefined, log)).toEqual({ allowWrite: [], allowedDomains: UNATTENDED_DOMAINS });
    expect(log).not.toHaveBeenCalled();
    expect(unattendedLimits({ allowWrite: 'x', allowedDomains: [1] }, log)).toEqual({ allowWrite: [], allowedDomains: UNATTENDED_DOMAINS });
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('drops localhost, IP addresses and NetBird names with one log line, and expands ~', () => {
    const log = vi.fn();
    const l = unattendedLimits({ allowWrite: ['~/cache'], allowedDomains: ['localhost', '127.0.0.1', '::1', 'x.netbird.cloud', 'example.com'] }, log);
    expect(l).toEqual({ allowWrite: [path.join(os.homedir(), 'cache')], allowedDomains: ['example.com'] });
    expect(log).toHaveBeenCalledOnce();
  });
});

describe('unattended hooks', () => {
  const worktree = path.join(root, 'wt');
  mkdirSync(path.join(worktree, '.git'), { recursive: true });
  symlinkSync(outside, path.join(worktree, 'link'));
  const rules = unattendedRules(worktree, { allowWrite: [], allowedDomains: ['pypi.org'] }, []);
  const hooks = new ToolHooks({ captureEdit: vi.fn() } as never);
  const pre = (tool_name: string, tool_input: unknown) => ({ hook_event_name: 'PreToolUse', tool_name, tool_input }) as unknown as HookInput;
  const verdict = (o: unknown) => (o as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } }).hookSpecificOutput;

  it('denies an edit outside the worktree or under its .git, and passes one inside', () => {
    const msg = 'This unattended run may only edit files in its worktree';
    for (const file of [path.join(outside, 'a.ts'), path.join(worktree, '.git/config'), path.join(worktree, '.git'), '/etc/hosts', path.join(worktree, 'link/a.ts'), path.join(worktree, '../../../../../../../../../x')]) {
      expect(verdict(hooks.beforeEdit(pre('Edit', { file_path: file }), rules))).toMatchObject({ permissionDecision: 'deny', permissionDecisionReason: msg });
    }
    expect(hooks.beforeEdit(pre('Write', { file_path: path.join(worktree, 'src/new.ts') }), rules)).toEqual({});
    expect(hooks.beforeEdit(pre('NotebookEdit', { notebook_path: path.join(os.tmpdir(), 'n.ipynb') }), rules)).toEqual({});
    expect(hooks.beforeEdit(pre('Edit', { file_path: '/etc/hosts' }))).toEqual({});
  });

  it('passes WebFetch to a listed domain only, and only the agentview connector tools', () => {
    expect(hooks.beforeTool(pre('WebFetch', { url: 'https://pypi.org/project/x' }), rules)).toEqual({});
    expect(verdict(hooks.beforeTool(pre('WebFetch', { url: 'https://github.com/a' }), rules))).toMatchObject({ permissionDecision: 'deny', permissionDecisionReason: 'This unattended run may only fetch pypi.org' });
    expect(verdict(hooks.beforeTool(pre('WebFetch', { url: 'https://evilpypi.org/' }), rules))?.permissionDecision).toBe('deny');
    expect(verdict(hooks.beforeTool(pre('mcp__slack__post_message', {}), rules))?.permissionDecision).toBe('deny');
    for (const tool of ['ListMcpResourcesTool', 'ReadMcpResourceTool']) expect(verdict(hooks.beforeTool(pre(tool, {}), rules))?.permissionDecision).toBe('deny');
    expect(hooks.beforeTool(pre('mcp__agentview__set_status', {}), rules)).toEqual({});
  });
});
