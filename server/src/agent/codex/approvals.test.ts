import { describe, expect, it } from 'bun:test';
import { answersFor, askFor, decisionFor, elicitationFor, hasFields, permissionsAsk, permissionsFor, policyFor, questionsAsk, readOnlyCommand, unwrapShell } from './approvals.js';
import { planUsage } from './usage.js';

describe('policyFor', () => {
  it('asks for edits and untrusted commands by default, never asks in Auto, and only reads in Plan', () => {
    expect(policyFor('default')).toMatchObject({ approvalPolicy: 'untrusted', sandbox: 'workspace-write', sandboxPolicy: { type: 'workspaceWrite' } });
    expect(policyFor('auto')).toMatchObject({ approvalPolicy: 'never', sandbox: 'workspace-write', sandboxPolicy: { type: 'workspaceWrite' } });
    expect(policyFor('plan')).toMatchObject({ approvalPolicy: 'never', sandbox: 'read-only', sandboxPolicy: { type: 'readOnly' } });
    expect(policyFor('readOnly')).toMatchObject({ approvalPolicy: 'never', sandbox: 'read-only' });
  });
  it('turns network on in Auto only', () => {
    expect(policyFor('auto').sandboxPolicy).toMatchObject({ networkAccess: true });
    expect(policyFor('default').sandboxPolicy).toMatchObject({ networkAccess: false });
  });
  it('makes the git folders writable in the workspace modes so commits work', () => {
    expect(policyFor('auto', ['/r/.git']).sandboxPolicy).toMatchObject({ writableRoots: ['/r/.git'] });
    expect(policyFor('default', ['/r/.git']).sandboxPolicy).toMatchObject({ writableRoots: ['/r/.git'] });
    expect(policyFor('readOnly', ['/r/.git']).sandboxPolicy).toEqual({ type: 'readOnly', networkAccess: false });
  });
});

describe('readOnlyCommand', () => {
  it('unwraps the login shell Codex runs commands in', () => {
    expect(unwrapShell("/bin/zsh -lc 'git status'")).toBe('git status');
    expect(unwrapShell('/bin/zsh -lc ls')).toBe('ls');
    expect(unwrapShell('make build')).toBe('make build');
  });
  it('accepts reads on the list, piped into other reads', () => {
    for (const c of ['/bin/zsh -lc ls', "/bin/zsh -lc 'git status'", "/bin/zsh -lc 'git diff --stat'", `/bin/zsh -lc "rg -n 'a|b' src | head -20"`, "/bin/zsh -lc \"sed -n '1,40p' a.ts\"", 'cat *.md', "/bin/zsh -lc \"nl -ba f | sed -n '1,20p'\"", "find . -name '*.ts'", "/bin/zsh -lc 'git status && git log -1'", 'pwd || ls', 'rg --files src']) expect(readOnlyCommand(c)).toBe(true);
  });
  it('refuses writers, redirects, substitutions and risky flags', () => {
    for (const c of ['touch x', "/bin/zsh -lc 'cat a > b'", "/bin/zsh -lc 'ls; rm x'", 'ls && rm x', 'cat $(ls)', 'ls | xargs rm', "sed -i '' s/a/b/ f", "sed -n '1w out' f", 'git commit -m x', 'git diff --output=x', 'rg --pre sh x', 'ls |', 'find . -delete', "find . -name '*.ts' -exec rm {} +", 'find . -execdir rm x', 'find . -fprint out', 'ls > x', 'ls &', 'ls & rm x', 'ls &&', 'ls || rm x']) expect(readOnlyCommand(c)).toBe(false);
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
    expect(askFor('item/commandExecution/requestApproval', { itemId: 'c1', command: "/bin/zsh -lc 'rm -rf out'", reason: 'outside the sandbox' }, new Map())).toEqual({ tool: 'Bash', input: { command: 'rm -rf out', description: 'outside the sandbox' }, detail: 'outside the sandbox' });
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
