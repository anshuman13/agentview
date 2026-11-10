import { expect, it } from 'vitest';
import { parseSaved, resumePrompt, runningAgents, stoppedOf } from './restore.js';

const events: any[] = [
  { id: 'w1', kind: 'tool_use', name: 'Workflow', input: { scriptPath: '/p/build.js' }, summary: '', at: 0 },
  { id: 'r1', kind: 'tool_result', toolUseId: 'w1', text: 'Started.\nRun ID: wf_abc', isError: false, at: 0 },
];

it('records a running workflow with its run id and script path', () => {
  const tasks = [{ toolUseId: 'w1', tool: 'Workflow', description: 'build' }, { toolUseId: 'b1', tool: 'Bash', description: 'watch' }];
  expect(stoppedOf(events, tasks, false)).toEqual({
    midTurn: false,
    tasks: [{ description: 'build', tool: 'Workflow', runId: 'wf_abc', scriptPath: '/p/build.js' }, { description: 'watch', tool: 'Bash' }],
  });
});

it('records nothing for an idle chat without tasks', () => {
  expect(stoppedOf(events, [], false)).toBeUndefined();
  expect(stoppedOf(events, [], true)).toEqual({ midTurn: true, tasks: [] });
});

it('keeps a valid stopped entry and drops a malformed one', () => {
  const stopped = { midTurn: true, tasks: [{ description: 'build', tool: 'Workflow', runId: 'wf_abc' }] };
  expect(parseSaved(JSON.stringify({ chats: [{ sessionId: 'a', stopped }] }))?.chats[0].stopped).toEqual(stopped);
  const bad = parseSaved(JSON.stringify({ chats: [{ sessionId: 'a', stopped: { midTurn: true, tasks: [{ tool: 'Bash' }] } }, { sessionId: 'b', stopped: { tasks: 'x' } }] }));
  expect(bad?.chats.map((c) => c.sessionId)).toEqual(['a', 'b']);
  expect(bad?.chats.some((c) => 'stopped' in c)).toBe(false);
});

it('asks Claude to resume workflows by run id', () => {
  const text = resumePrompt({ midTurn: true, tasks: [{ description: 'build', tool: 'Workflow', runId: 'wf_abc', scriptPath: '/p/build.js' }] });
  expect(text).toContain('wf_abc');
  expect(text).toContain('resumeFromRunId');
  expect(text).toContain('/p/build.js');
});

it('lists running agents oldest first and leaves out ended ones', () => {
  const agent = (toolUseId: string, status: string, startedAt: number, group?: string, prompt = '') => ({ kind: 'agent', toolUseId, description: toolUseId, subagentType: 'implementer', prompt, status, startedAt, group });
  const chat = { state: { events: [agent('b', 'running', 20, 'build'), agent('x', 'done', 5), agent('a', 'running', 10)] } } as any;
  expect(runningAgents(chat)).toEqual([{ id: 'a', description: 'a', type: 'implementer', startedAt: 10 }, { id: 'b', description: 'b', type: 'implementer', group: 'build', startedAt: 20 }]);
  const named = { state: { events: [agent('c', 'running', 30, undefined, 'Implement .claude/specs/x-1.md')] } } as any;
  expect(runningAgents(named)).toEqual([{ id: 'c', description: 'c', type: 'implementer', slug: 'x-1', startedAt: 30 }]);
  expect(runningAgents({ state: { events: [agent('x', 'done', 5)] } } as any)).toEqual([]);
});

it('returns null for input that is not a saved chat list', () => {
  expect(parseSaved('{}')).toBeNull();
  expect(parseSaved('null')).toBeNull();
  expect(parseSaved('not json')).toBeNull();
  expect(parseSaved('{"chats":"x"}')).toBeNull();
});

it('fills in missing crons and drops entries without a session id', () => {
  const r = parseSaved('{"view":"a","chats":[{"sessionId":"a"},{"crons":[]},null,{"sessionId":"b","crons":[{"id":"c"}]}]}');
  expect(r).toEqual({ view: 'a', chats: [{ sessionId: 'a', crons: [] }, { sessionId: 'b', crons: [{ id: 'c' }] }] });
});
