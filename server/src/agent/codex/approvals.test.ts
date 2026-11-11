import { describe, expect, it } from 'bun:test';
import { answersFor, askFor, decisionFor, elicitationFor, hasFields, permissionsAsk, permissionsFor, policyFor, questionsAsk } from './approvals.js';
import { planUsage } from './usage.js';

describe('policyFor', () => {
  it('asks in the workspace sandbox by default, never asks in Auto, and only reads in Plan', () => {
    expect(policyFor('default')).toMatchObject({ approvalPolicy: 'on-request', sandbox: 'workspace-write' });
    expect(policyFor('auto')).toMatchObject({ approvalPolicy: 'never', sandbox: 'workspace-write', sandboxPolicy: { type: 'workspaceWrite' } });
    expect(policyFor('plan')).toMatchObject({ approvalPolicy: 'never', sandbox: 'read-only', sandboxPolicy: { type: 'readOnly' } });
    expect(policyFor('readOnly')).toMatchObject({ approvalPolicy: 'never', sandbox: 'read-only' });
  });
  it('turns network on in Auto only', () => {
    expect(policyFor('auto').sandboxPolicy).toMatchObject({ networkAccess: true });
    expect(policyFor('default').sandboxPolicy).toMatchObject({ networkAccess: false });
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
    expect(askFor('item/fileChange/requestApproval', { itemId: 'f1' }, files)).toMatchObject({ tool: 'MultiEdit', input: { file_path: 'a.ts' }, title: 'Edit 2 files' });
  });
  it('carries the diff of a file change as an edit', () => {
    const files = new Map([['f1', [{ path: 'a.ts', kind: { type: 'update' as const, move_path: null }, diff: '@@ -1 +1 @@\n-old\n+new' }]]]);
    expect(askFor('item/fileChange/requestApproval', { itemId: 'f1' }, files)).toMatchObject({ tool: 'Edit', input: { file_path: 'a.ts', old_string: 'old', new_string: 'new' } });
  });
});

describe('questions', () => {
  const questions = [{ id: 'q1', header: 'Pick', question: 'Which one?', options: [{ label: 'a', description: 'first' }] }, { id: 'q2', header: 'Name', question: 'Called?', options: null }];
  it('become an AskUserQuestion ask and return the answers by question id', () => {
    const ask = questionsAsk(questions);
    expect(ask.tool).toBe('AskUserQuestion');
    expect(ask.input.questions).toMatchObject([{ question: 'Which one?', options: [{ label: 'a' }] }, { question: 'Called?', options: [] }]);
    expect(answersFor(questions, { behavior: 'allow', updatedInput: { answers: { 'Which one?': 'a', 'Called?': 'x' } } })).toEqual({ answers: { q1: { answers: ['a'] }, q2: { answers: ['x'] } } });
    expect(answersFor(questions, { behavior: 'deny', message: 'aborted' })).toEqual({ answers: {} });
  });
});

describe('permissions', () => {
  const requested = { network: { enabled: true }, fileSystem: null };
  const allow = { behavior: 'allow' as const, updatedInput: {} };
  it('grants the request for the turn on Allow, for the session on Always, and nothing on Deny', () => {
    expect(permissionsFor(requested, allow, false)).toEqual({ permissions: { network: { enabled: true } }, scope: 'turn' });
    expect(permissionsFor(requested, { ...allow, updatedPermissions: [{}] }, false)).toMatchObject({ scope: 'session' });
    expect(permissionsFor(requested, { behavior: 'deny', message: 'no' }, false).permissions).toEqual({});
    expect(permissionsFor(requested, allow, true).permissions).toEqual({});
  });
  it('titles the card', () => {
    expect(permissionsAsk({ permissions: requested })).toMatchObject({ title: 'Codex asks for more permissions', input: { network: 'on' } });
  });
});

describe('elicitation', () => {
  it('declines a form with fields and asks for a link or an empty form', () => {
    expect(hasFields({ serverName: 's', mode: 'form', message: 'm', requestedSchema: { properties: { a: {} } } })).toBe(true);
    expect(hasFields({ serverName: 's', mode: 'form', message: 'm', requestedSchema: { properties: {} } })).toBe(false);
    expect(hasFields({ serverName: 's', mode: 'url', message: 'm', url: 'https://x.test' })).toBe(false);
  });
  it('accepts, declines or cancels', () => {
    expect(elicitationFor({ behavior: 'allow', updatedInput: {} }, false).action).toBe('accept');
    expect(elicitationFor({ behavior: 'deny', message: 'no' }, false).action).toBe('decline');
    expect(elicitationFor(null, false).action).toBe('decline');
    expect(elicitationFor({ behavior: 'deny', message: 'aborted' }, true).action).toBe('cancel');
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
