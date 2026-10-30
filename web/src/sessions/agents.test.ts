import { describe, expect, it } from 'vitest';
import { agentCounts, buildAgents, reportText } from './agents';
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
