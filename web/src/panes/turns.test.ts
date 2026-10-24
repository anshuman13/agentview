import { describe, expect, it } from 'vitest';
import { buildTurns } from './turns';
import type { ChatEvent } from '../../../shared/protocol';

let n = 0;
const at = () => ++n;
const user = (text: string): ChatEvent => ({ id: `u${at()}`, kind: 'user', text, at: n });
const say = (text: string): ChatEvent => ({ id: `a${at()}`, kind: 'assistant', text, streaming: false, at: n });
const status = (input: Record<string, unknown>): ChatEvent => ({ id: `s${at()}`, kind: 'tool_use', name: 'mcp__agentview__set_status', input, summary: '', at: n });
const tool = (name: string, input: Record<string, unknown> = {}, parent?: string): ChatEvent => ({ id: `t${at()}`, kind: 'tool_use', name, input, summary: name, at: n, parent });
const result = (use: ChatEvent, text = 'ok', isError = false): ChatEvent => ({ id: `r${at()}`, kind: 'tool_result', toolUseId: use.id, text, isError, at: n });

describe('buildTurns', () => {
  it('makes one turn per prompt with its last reply and steps', () => {
    const read = tool('Read', { file_path: '/w/a.ts' });
    const { turns } = buildTurns([user('fix it'), say('Looking'), read, result(read), say('Fixed. Commit?'), user('yes')]);
    expect(turns.map((t) => [t.prompt, t.reply?.text])).toEqual([['fix it', 'Fixed. Commit?'], ['yes', undefined]]);
    expect(turns[0].steps.map((s) => s.kind)).toEqual(['assistant', 'step']);
  });

  it('keeps every note of a turn, important ones included', () => {
    const { turns } = buildTurns([
      user('push it'),
      status({ text: 'a', important: 'Auto mode blocked the push' }),
      status({ text: 'b', done: 'Lock pushed', important: ' ' }),
      status({ text: 'c', important: 'CI is slow today' }),
    ]);
    expect(turns[0].notes.map((x) => [x.kind, x.text])).toEqual([
      ['important', 'Auto mode blocked the push'],
      ['done', 'Lock pushed'],
      ['important', 'CI is slow today'],
    ]);
  });

  it('collects files, failed commands and commits from tool events', () => {
    const e1 = tool('Edit', { file_path: '/w/a.ts', old_string: 'x', new_string: 'y\nz' });
    const e2 = tool('Edit', { file_path: '/w/a.ts', old_string: 'q', new_string: 'r' });
    const bad = tool('Edit', { file_path: '/w/b.ts', old_string: 'q', new_string: 'r' });
    const test = tool('Bash', { command: 'npm test', description: 'Run the tests' });
    const commit = tool('Bash', { command: 'git add -A && git commit -m "Fix it"' });
    const { turns } = buildTurns([
      user('go'), e1, result(e1), e2, result(e2), bad, result(bad, 'String not found', true),
      test, result(test, 'Exit code 1\nFAIL src/a.test.ts', true),
      commit, result(commit, '[main 1a2b3c4] Fix it\n 1 file changed'),
    ]);
    const t = turns[0];
    expect(t.files).toEqual([{ path: '/w/a.ts', add: 3, del: 2 }]);
    expect(t.commands.map((c) => c.error)).toEqual(['FAIL src/a.test.ts', undefined]);
    expect(t.commits).toEqual([{ hash: '1a2b3c4', subject: 'Fix it' }]);
  });

  it('shows a denied tool as denied, not failed', () => {
    const push = tool('Bash', { command: 'git push', description: 'Push to main' });
    const edit = tool('Edit', { file_path: '/w/a.ts', old_string: 'x', new_string: 'y' });
    const fable = tool('Agent', { subagent_type: 'big-bro', description: 'Check the design' });
    const { turns } = buildTurns([
      user('go'), push, result(push, "The user doesn't want to proceed with this tool use. The tool use was rejected.", true),
      edit, result(edit, 'User denied this action in the AgentView UI.', true),
      fable, result(fable, 'aborted', true),
    ]);
    const t = turns[0];
    expect(t.commands).toEqual([{ id: push.id, label: 'Push to main', denied: true }]);
    expect(t.files).toEqual([]);
    expect(t.agents[0].state).toBe('denied');
    expect(t.steps.filter((s) => s.kind === 'file')).toMatchObject([{ path: '/w/a.ts', error: 'Denied', denied: true }]);
  });

  it('lists subagents with their state and keeps their steps in the turn that launched them', () => {
    const agent = tool('Agent', { description: 'Review', subagent_type: 'general-purpose' });
    const child = tool('Edit', { file_path: '/w/c.ts', old_string: 'a', new_string: 'b' }, agent.id);
    const { turns } = buildTurns([user('go'), agent, user('meanwhile'), child, result(child)]);
    expect(turns[0].agents).toEqual([{ id: agent.id, label: 'Review', type: 'general-purpose', state: 'running' }]);
    expect(turns[0].files.map((f) => f.path)).toEqual(['/w/c.ts']);
    expect(turns[1].files).toEqual([]);
  });

  it('tracks next steps from status and plan changes, cleared by a new prompt', () => {
    const plan: ChatEvent = { id: `p${at()}`, kind: 'plan', next: ['curl /check'], at: n };
    expect(buildTurns([user('go'), status({ text: 'a', next: ['b', 'c'] }), status({ text: 'b', next: ['c'] })]).next).toEqual(['c']);
    expect(buildTurns([user('go'), status({ text: 'a', next: ['b'] }), user('steer')]).next).toEqual([]);
    expect(buildTurns([user('go'), status({ text: 'a', next: ['b'] }), plan]).next).toEqual(['curl /check']);
  });

  it('ignores the status tool for the last tool and counts advisor and Fable consults', () => {
    const ask = tool('Agent', { subagent_type: 'big-bro' });
    const answer = result(ask, '[Subagent hand-back] The report follows:\n  Use a lock.\n  Then retry.\nagentId: a1');
    const b = buildTurns([user('go'), tool('Advisor'), tool('Advisor'), ask, answer, tool('Bash'), status({ text: 'x' })]);
    expect(b.lastTool?.name).toBe('Bash');
    expect(b.advisor).toBe(2);
    expect(b.fable).toBe(1);
    expect(b.turns[0].notes.at(-1)).toMatchObject({ kind: 'fable', text: 'Use a lock.\nThen retry.' });
  });
});
