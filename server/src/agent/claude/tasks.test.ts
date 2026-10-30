import { describe, expect, it } from 'vitest';
import { bigBroRequest } from './approval.js';
import { usageWindow } from './usage.js';

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
});
