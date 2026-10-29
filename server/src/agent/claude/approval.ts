import type { HookInput, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import { BIG_BRO } from '../../../../shared/protocol.js';

export const bigBroRequest = (input: HookInput) => {
  if (input.hook_event_name !== 'PreToolUse') return null;
  const toolInput = (input.tool_input ?? {}) as Record<string, unknown>;
  return toolInput.subagent_type === BIG_BRO ? { toolName: input.tool_name, toolInput, title: `Ask Fable: ${String(toolInput.description ?? 'a hard problem')}` } : null;
};

export const bigBroVerdict = (behavior: string): HookJSONOutput => ({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: behavior === 'allow' ? 'allow' : 'deny',
    permissionDecisionReason: behavior === 'allow' ? undefined : 'The user declined to ask Fable. Continue without it.',
  },
});
