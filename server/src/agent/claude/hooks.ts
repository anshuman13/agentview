import type { SDKHookResponseMessage } from '@anthropic-ai/claude-agent-sdk';

// Exit code 2 is how a hook blocks the action it ran for.
const BLOCKED = 2;

// The transcript line for a hook that blocked or failed; null for one that ran fine.
export function hookLine(m: Pick<SDKHookResponseMessage, 'hook_name' | 'hook_event' | 'outcome' | 'exit_code' | 'stderr' | 'output' | 'stdout'>): string | null {
  if (m.outcome !== 'error') return null;
  const reason = [m.stderr, m.output, m.stdout].map((t) => t.trim().split('\n')[0]).find(Boolean)?.slice(0, 200);
  const tail = reason ? `: ${reason}` : '';
  if (m.exit_code === BLOCKED) return `Hook blocked ${m.hook_name.split(':')[1] || m.hook_event}${tail}`;
  return `${m.hook_event} hook failed${tail}`;
}
