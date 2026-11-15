import { describe, expect, it, vi } from 'bun:test';
import type { HookInput } from '@anthropic-ai/claude-agent-sdk';
import { BUILD_FLOW_ON, SUBAGENT_STEPS, ToolHooks } from './toolHooks';
import { STATUS_RULES, statusTool } from '../tools/status';

const hooks = (buildFlow = false) => new ToolHooks({ state: { session: { buildFlow } } } as never);
const ctx = (setStatus = vi.fn()) => ({ cwd: '/w', chatId: 'c', provider: 'claude' as const, host: { setStatus, goal: vi.fn(), startChat: vi.fn() } });
const context = (o: unknown) => (o as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput?.additionalContext;

describe('step reporting', () => {
  it('set_status takes a decision and why, and a subagent call leaves the status line alone', async () => {
    const setStatus = vi.fn();
    await statusTool.handler({ text: 't', done: 'Build the navbar', decision: 'Flex row', why: 'Fits the shell' }, ctx(setStatus));
    expect(setStatus).toHaveBeenCalledWith('t', { done: 'Build the navbar', next: undefined });
    await statusTool.handler({ text: 't', done: 'x', agent: 'a1' }, ctx(setStatus));
    expect(setStatus).toHaveBeenCalledTimes(1);
    expect(STATUS_RULES).toContain('imperative');
    expect(STATUS_RULES).toContain('at most 3 sentences');
  });

  it('marks only subagent status calls', () => {
    const pre = (agent_id?: string) => ({ hook_event_name: 'PreToolUse', tool_name: 'mcp__agentview__set_status', tool_input: { text: 't' }, ...(agent_id && { agent_id }) }) as unknown as HookInput;
    expect(hooks().beforeStatus(pre())).toEqual({});
    expect((hooks().beforeStatus(pre('a1')) as { hookSpecificOutput: { updatedInput: unknown } }).hookSpecificOutput.updatedInput).toEqual({ text: 't', agent: 'a1' });
  });

  it('asks subagents for steps except Fable and the approval gate', () => {
    const start = (agent_type: string) => ({ hook_event_name: 'SubagentStart', agent_id: 'a', agent_type }) as unknown as HookInput;
    expect(context(hooks().onSubagentStart(start('general-purpose')))).toBe(SUBAGENT_STEPS);
    expect(hooks().onSubagentStart(start('big-bro'))).toEqual({});
    expect(hooks().onSubagentStart(start('agentview:approval-gate'))).toEqual({});
  });

  it('adds the build flow note to prompts only when the option is on', () => {
    const prompt = { hook_event_name: 'UserPromptSubmit', prompt: 'build it' } as unknown as HookInput;
    expect(hooks().onPrompt(prompt)).toEqual({});
    expect(context(hooks(true).onPrompt(prompt))).toBe(BUILD_FLOW_ON);
  });
});
