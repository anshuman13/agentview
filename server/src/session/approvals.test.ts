import { describe, expect, it } from 'vitest';
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import { Approvals, permissionTitle } from './approvals.js';
import type { ServerMessage, ServerState } from '../../../shared/protocol.js';

describe('permissionTitle', () => {
  it('describes tools in plain words', () => {
    expect(permissionTitle('Bash', { command: 'ls', description: 'List files' })).toBe('List files');
    expect(permissionTitle('Edit', { file_path: '/repo/src/a.ts' })).toBe('Edit a.ts');
    expect(permissionTitle('WebFetch', { url: 'https://example.com/x' })).toBe('Fetch a page from example.com');
    expect(permissionTitle('mcp__claude-in-chrome__read_page', {})).toBe('Use read page from claude-in-chrome');
  });
});

describe('Approvals', () => {
  const suggestions: PermissionUpdate[] = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'ls' }], behavior: 'allow', destination: 'session' }];

  function setup() {
    const state = { pending: [] } as unknown as ServerState;
    const sent: ServerMessage[] = [];
    const a = new Approvals(state, (m) => sent.push(m));
    const ask = (tool: string, input: Record<string, unknown>, opts: Partial<Parameters<Approvals['ask']>[2]> = {}) => a.ask(tool, input, { signal: new AbortController().signal, ...opts });
    return { a, state, sent, ask };
  }

  it('an abort resolves as deny and clears the card', async () => {
    const { ask, state, sent } = setup();
    const ac = new AbortController();
    const decision = ask('Bash', { command: 'ls' }, { signal: ac.signal });
    expect(state.pending).toHaveLength(1);
    ac.abort();
    expect(await decision).toEqual({ behavior: 'deny', message: 'aborted' });
    expect(state.pending).toEqual([]);
    expect(sent.map((m) => m.type)).toEqual(['pending', 'resolved']);
  });

  it('always passes the suggested rules through, a plain allow does not', async () => {
    const { a, ask, state } = setup();
    const once = ask('Bash', { command: 'ls' }, { suggestions });
    expect(state.pending[0]).toMatchObject({ kind: 'permission', canAlwaysAllow: true });
    a.answerPermission(state.pending[0].id, true);
    expect(await once).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' }, updatedPermissions: undefined });
    const always = ask('Bash', { command: 'ls' }, { suggestions });
    a.answerPermission(state.pending[0].id, true, true);
    expect(await always).toMatchObject({ behavior: 'allow', updatedPermissions: suggestions });
  });

  it('denies when the user says no', async () => {
    const { a, ask, state } = setup();
    const decision = ask('Bash', { command: 'rm -rf x' });
    a.answerPermission(state.pending[0].id, false);
    expect(await decision).toMatchObject({ behavior: 'deny' });
  });

  it('merges the answers into the question input', async () => {
    const { a, ask, state } = setup();
    const questions = [{ question: 'Which?', header: 'Pick', options: [{ label: 'a', description: '' }], multiSelect: false }];
    const decision = ask('AskUserQuestion', { questions });
    expect(state.pending[0]).toMatchObject({ kind: 'question', questions });
    a.answerQuestion(state.pending[0].id, { 'Which?': 'a' });
    expect(await decision).toEqual({ behavior: 'allow', updatedInput: { questions, answers: { 'Which?': 'a' } } });
    expect(state.pending).toEqual([]);
  });

  it('denyAll answers every open card', async () => {
    const { a, ask, state } = setup();
    const one = ask('Bash', { command: 'ls' });
    const two = ask('Read', { file_path: '/x' });
    a.denyAll('Session closed');
    expect(await Promise.all([one, two])).toEqual([{ behavior: 'deny', message: 'Session closed' }, { behavior: 'deny', message: 'Session closed' }]);
    expect(state.pending).toEqual([]);
  });
});
