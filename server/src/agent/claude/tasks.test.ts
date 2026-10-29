import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../../../shared/protocol.js';
import { bigBroRequest, bigBroVerdict } from './approval.js';
import { agentResultPatch, replayText, same, unchanged, usageOf } from './tasks.js';
import { sessionUsage, usageWindow } from './usage.js';

describe('task helpers', () => {
  it('compares values structurally', () => {
    expect(same({ a: 1 }, { a: 1 })).toBe(true);
    expect(same({ a: 1 }, { a: 2 })).toBe(false);
    expect(same(1, 1)).toBe(true);
  });

  it('renames usage fields', () => {
    expect(usageOf({ total_tokens: 5, tool_uses: 2, duration_ms: 9 })).toEqual({ tokens: 5, toolUses: 2, durationMs: 9 });
  });

  it('detects unchanged patches', () => {
    const a = { status: 'done', usage: { tokens: 1, toolUses: 1, durationMs: 1 } } as AgentEvent;
    expect(unchanged(a, { status: 'done', usage: { tokens: 1, toolUses: 1, durationMs: 1 } })).toBe(true);
    expect(unchanged(a, { status: 'failed' })).toBe(false);
  });

  it('patches an agent from its tool result', () => {
    const a = { usage: undefined } as unknown as AgentEvent;
    const patch = agentResultPatch('done', true, { resolvedModel: 'm', totalTokens: 7 }, 100)(a);
    expect(patch).toMatchObject({ status: 'failed', endedAt: 100, model: 'm', usage: { tokens: 7, toolUses: 0, durationMs: 0 } });
  });

  it('reads replay text from string or block content', () => {
    expect(replayText('hi')).toBe('hi');
    expect(replayText([{ type: 'image' }, { type: 'text', text: 'yo' }])).toBe('yo');
    expect(replayText(undefined)).toBeUndefined();
  });
});

describe('big bro approval', () => {
  const hook = (name: string, input: unknown) => ({ hook_event_name: 'PreToolUse', tool_name: name, tool_input: input }) as never;

  it('asks only for Fable subagent calls', () => {
    expect(bigBroRequest(hook('Agent', { subagent_type: 'general-purpose' }))).toBeNull();
    expect(bigBroRequest({ hook_event_name: 'PostToolUse' } as never)).toBeNull();
    expect(bigBroRequest(hook('Agent', { subagent_type: 'big-bro' }))?.title).toBe('Ask Fable: a hard problem');
  });

  it('maps the answer to a hook decision', () => {
    expect(bigBroVerdict('allow')).toEqual({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: undefined } });
    expect(bigBroVerdict('deny')).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
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
