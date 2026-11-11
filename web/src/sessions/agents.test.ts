import { describe, expect, it } from 'bun:test';
import { agentCounts, agentSummary, buildAgents, reportText } from './agents';
import { buildTranscript } from '../chat/transcript/steps';
import type { AgentEvent, ChatEvent } from '../../../shared/protocol';

const use = (id: string, input: Record<string, unknown>, at: number, parent?: string): ChatEvent => ({ id, kind: 'tool_use', name: 'Agent', input, summary: '', at, ...(parent && { parent }) });
const info = (toolUseId: string, patch: Partial<AgentEvent>): ChatEvent => ({ id: `${toolUseId}:agent`, kind: 'agent', toolUseId, description: '', subagentType: 'Explore', model: 'claude-opus-5-5', background: true, prompt: 'Find docs', status: 'running', startedAt: 1, endedAt: null, progress: null, usage: null, at: 1, ...patch });

describe('buildAgents', () => {
  it('lists agents with their steps, status and last step, nested ones included', () => {
    const events: ChatEvent[] = [
      use('a1', { description: 'Survey', prompt: 'Find docs' }, 1),
      info('a1', { status: 'done', endedAt: 9 }),
      { id: 's1', kind: 'tool_use', name: 'Read', input: { file_path: 'README.md' }, summary: '', at: 2, parent: 'a1' },
      { id: 't1', kind: 'assistant', text: 'Found it\nmore', streaming: false, at: 3, parent: 'a1' },
      use('a2', { description: 'Nested', subagent_type: 'Plan' }, 4, 'a1'),
      { id: 'r1', kind: 'tool_result', toolUseId: 'a1', text: 'Report', isError: false, at: 9 },
      use('a3', { description: 'Still going' }, 10),
    ];
    const agents = buildAgents(events);
    expect(agents.map((a) => [a.id, a.description, a.status])).toEqual([['a1', 'Survey', 'done'], ['a2', 'Nested', 'running'], ['a3', 'Still going', 'running']]);
    expect(agents[0]).toMatchObject({ type: 'Explore', model: 'claude-opus-5-5', prompt: 'Find docs', endedAt: 9, lastStep: 'Delegated Nested' });
    expect(agents[0].steps.map((s) => s.kind)).toEqual(['step', 'assistant', 'agent']);
    expect(agents[0].result?.text).toBe('Report');
    expect(agents[1].type).toBe('Plan');
    expect(agentCounts(agents)).toEqual({ running: 2, done: 1 });
  });

  it('trusts an ended task over a missing tool result, and tracks the last activity', () => {
    const events: ChatEvent[] = [
      use('a1', { description: 'Killed' }, 1),
      info('a1', { status: 'stopped', endedAt: 5 }),
      use('a2', { description: 'Quiet' }, 1),
      info('a2', {}),
      { id: 's1', kind: 'tool_use', name: 'Read', input: { file_path: 'a.md' }, summary: '', at: 7, parent: 'a2' },
    ];
    const agents = buildAgents(events);
    expect(agents.map((a) => [a.id, a.status, a.endedAt])).toEqual([['a1', 'stopped', 5], ['a2', 'running', null]]);
    expect(agents[1].lastAt).toBe(7);
  });
});

describe('reportText', () => {
  it('shows the status for a failed agent with no report', () => {
    const [a] = buildAgents([use('a1', { description: 'Broken' }, 1), info('a1', { status: 'failed', endedAt: 5 })]);
    expect(reportText(a)).toBe('Agent failed');
  });
});

describe('workflow agents', () => {
  it('carries the group from the agent event', () => {
    const agents = buildAgents([use('w:k', { description: 'impl:chat' }, 1), info('w:k', { group: 'build', description: 'impl:chat' }), use('a', { description: 'Plain' }, 2), info('a', {})]);
    expect(agents.map((a) => a.group)).toEqual(['build', undefined]);
  });
});

describe('agentSummary', () => {
  const read: ChatEvent = { id: 's1', kind: 'tool_use', name: 'Read', input: { file_path: 'steps.ts' }, summary: '', at: 2, parent: 'a1' };
  const done = (text: string, extra: Partial<Extract<ChatEvent, { kind: 'tool_result' }>> = {}): ChatEvent => ({ id: 'r1', kind: 'tool_result', toolUseId: 'a1', text, isError: false, at: 9, ...extra });
  const summary = (events: ChatEvent[]) => agentSummary(buildTranscript([use('a1', {}, 1), ...events])[0] as Parameters<typeof agentSummary>[0]);

  it('shows the progress, else the last step, else Starting while running', () => {
    expect(summary([read, info('a1', { progress: 'Reading the docs' })])).toBe('Reading the docs');
    expect(summary([read])).toBe('Read steps.ts');
    expect(summary([])).toBe('Starting…');
  });

  it('shows the first line of the report when done, and No report for an empty one', () => {
    expect(summary([done('## Result\nAll good')])).toBe('Result');
    expect(summary([done('---\n- Found it\nmore')])).toBe('Found it');
    expect(summary([done('x'.repeat(300))])).toHaveLength(200);
    expect(summary([done('')])).toBe('No report');
  });

  it('shows the error, else the progress, when stopped or failed', () => {
    expect(summary([info('a1', { progress: 'Checking tests' }), done('', { stopped: true, isError: true })])).toBe('Checking tests');
    expect(summary([done('Boom\nstack', { isError: true })])).toBe('Boom');
    expect(summary([done('', { isError: true })])).toBe('Agent failed');
    expect(summary([done('', { stopped: true })])).toBe('Agent stopped');
  });
});
