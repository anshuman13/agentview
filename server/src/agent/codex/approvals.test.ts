import { describe, expect, it } from 'vitest';
import { askFor, decisionFor, policyFor } from './approvals.js';
import { planUsage } from './usage.js';

describe('policyFor', () => {
  it('asks in the workspace sandbox by default, never asks in Auto, and only reads in Plan', () => {
    expect(policyFor('default')).toMatchObject({ approvalPolicy: 'on-request', sandbox: 'workspace-write' });
    expect(policyFor('auto')).toMatchObject({ approvalPolicy: 'never', sandbox: 'workspace-write', sandboxPolicy: { type: 'workspaceWrite' } });
    expect(policyFor('plan')).toMatchObject({ approvalPolicy: 'never', sandbox: 'read-only', sandboxPolicy: { type: 'readOnly' } });
  });
});

describe('decisionFor', () => {
  const allow = { behavior: 'allow' as const, updatedInput: {} };
  it('maps Allow, Always and Deny to accept, acceptForSession and decline', () => {
    expect(decisionFor(allow, false)).toBe('accept');
    expect(decisionFor({ ...allow, updatedPermissions: [{ type: 'acceptForSession' }] }, false)).toBe('acceptForSession');
    expect(decisionFor({ behavior: 'deny', message: 'no' }, false)).toBe('decline');
  });
  it('cancels a card that was dismissed', () => {
    expect(decisionFor({ behavior: 'deny', message: 'aborted' }, true)).toBe('cancel');
  });
});

describe('askFor', () => {
  it('shows a command with the reason as its description', () => {
    expect(askFor('item/commandExecution/requestApproval', { itemId: 'c1', command: 'rm -rf out', reason: 'outside the sandbox' }, new Map())).toEqual({ tool: 'Bash', input: { command: 'rm -rf out', description: 'outside the sandbox' }, detail: 'outside the sandbox' });
  });
  it('names the files of the announced file change', () => {
    const files = new Map([['f1', [{ path: 'a.ts', kind: { type: 'add' as const }, diff: '' }, { path: 'b.ts', kind: { type: 'add' as const }, diff: '' }]]]);
    expect(askFor('item/fileChange/requestApproval', { itemId: 'f1' }, files)).toMatchObject({ tool: 'Edit', input: { file_path: 'a.ts' }, title: 'Edit 2 files' });
  });
});

describe('planUsage', () => {
  it('tells the 5-hour and weekly windows apart by length, with reset times in seconds', () => {
    const u = planUsage({ primary: { usedPercent: 12.4, windowDurationMins: 300, resetsAt: 1794260000 }, secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: null } });
    expect(u).toEqual({ fiveHour: { pct: 12, resetsAt: 1794260000000 }, week: { pct: 40, resetsAt: null } });
  });
  it('leaves a window out when the plan does not report it', () => {
    expect(planUsage({ primary: { usedPercent: 5, windowDurationMins: 10080, resetsAt: null }, secondary: null })).toEqual({ fiveHour: null, week: { pct: 5, resetsAt: null } });
  });
});
