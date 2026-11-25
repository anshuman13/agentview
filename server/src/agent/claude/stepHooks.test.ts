import { describe, expect, it, vi } from 'bun:test';
import type { HookInput } from '@anthropic-ai/claude-agent-sdk';
import { SUBAGENT_STEPS, ToolHooks } from './toolHooks';
import { STATUS_RULES, statusTool } from '../tools/status';

const hooks = () => new ToolHooks({ state: { session: {} } } as never);
const ctx = (setStatus = vi.fn()) => ({ cwd: '/w', chatId: 'c', provider: 'claude' as const, host: { setStatus, phoneAlarm: vi.fn() } });
const context = (o: unknown) => (o as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput?.additionalContext;

describe('step reporting', () => {
  it('set_status reports a finished task, and a subagent call leaves the status line alone', async () => {
    const setStatus = vi.fn();
    await statusTool.handler({ text: 't', done: 'Added a navbar' }, ctx(setStatus));
    expect(setStatus).toHaveBeenCalledWith('t', { done: 'Added a navbar', next: undefined });
    await statusTool.handler({ text: 't', done: 'x', agent: 'a1' }, ctx(setStatus));
    expect(setStatus).toHaveBeenCalledTimes(1);
    expect(STATUS_RULES).toContain('what you changed');
    expect(STATUS_RULES).toContain('one or two short sentences');
  });

  it('marks only subagent status calls', () => {
    const pre = (agent_id?: string) => ({ hook_event_name: 'PreToolUse', tool_name: 'mcp__agentview__set_status', tool_input: { text: 't' }, ...(agent_id && { agent_id }) }) as unknown as HookInput;
    expect(hooks().beforeStatus(pre())).toEqual({});
    expect((hooks().beforeStatus(pre('a1')) as { hookSpecificOutput: { updatedInput: unknown } }).hookSpecificOutput.updatedInput).toEqual({ text: 't', agent: 'a1' });
  });

  it('asks subagents for steps except Fable', () => {
    const start = (agent_type: string) => ({ hook_event_name: 'SubagentStart', agent_id: 'a', agent_type }) as unknown as HookInput;
    expect(context(hooks().onSubagentStart(start('general-purpose')))).toBe(SUBAGENT_STEPS);
    expect(hooks().onSubagentStart(start('big-bro'))).toEqual({});
  });
});
