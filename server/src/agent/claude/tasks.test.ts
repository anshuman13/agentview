import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../../../shared/protocol.js';
import { bigBroRequest } from './approval.js';
import { agentResultPatch, replayText, same, unchanged, usageOf } from './tasks.js';
import { sessionUsage, usageWindow } from './usage.js';

describe('task helpers', () => {

  it('patches an agent from its tool result', () => {
    const a = { usage: undefined } as unknown as AgentEvent;
    const patch = agentResultPatch('done', true, { resolvedModel: 'm', totalTokens: 7 }, 100)(a);
    expect(patch).toMatchObject({ status: 'failed', endedAt: 100, model: 'm', usage: { tokens: 7, toolUses: 0, durationMs: 0 } });
  });

});

describe('big bro approval', () => {
  const hook = (name: string, input: unknown) => ({ hook_event_name: 'PreToolUse', tool_name: name, tool_input: input }) as never;

  it('asks only for Fable subagent calls', () => {
    expect(bigBroRequest(hook('Agent', { subagent_type: 'general-purpose' }))).toBeNull();
    expect(bigBroRequest({ hook_event_name: 'PostToolUse' } as never)).toBeNull();
    expect(bigBroRequest(hook('Agent', { subagent_type: 'big-bro' }))?.title).toBe('Ask Fable: a hard problem');
  });
});

describe('usage windows', () => {
  it('rounds utilization and parses the reset time', () => {
    expect(usageWindow({ utilization: 41.6, resets_at: '2026-01-01T00:00:00Z' })).toEqual({ pct: 42, resetsAt: Date.parse('2026-01-01T00:00:00Z') });
    expect(usageWindow({ utilization: null, resets_at: null })).toBeNull();
  });

  it('is null without rate limits', () => {
    expect(sessionUsage({ rate_limits_available: false })).toBeNull();
    expect(sessionUsage({ rate_limits_available: true, rate_limits: { five_hour: { utilization: 10, resets_at: null }, seven_day: null } })).toEqual({ fiveHour: { pct: 10, resetsAt: null }, week: null });
  });
});
