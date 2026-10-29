import type { AgentEvent, AgentStatus } from '../../../../shared/protocol.js';
import { ASYNC_LAUNCH, usageFrom } from './transcript.js';

export const ENDED: Record<string, AgentStatus> = { completed: 'done', failed: 'failed', stopped: 'stopped', killed: 'stopped' };

export const same = (a: unknown, b: unknown) => a === b || (typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b));

export const usageOf = (u: { total_tokens: number; tool_uses: number; duration_ms: number }) => ({ tokens: u.total_tokens, toolUses: u.tool_uses, durationMs: u.duration_ms });

export const unchanged = (a: AgentEvent, next: Partial<AgentEvent>) => Object.entries(next).every(([k, v]) => same(a[k as keyof AgentEvent], v));

export const agentResultPatch = (text: string, isError: boolean, output: any, now: number): ((a: AgentEvent) => Partial<AgentEvent>) => {
  const model = typeof output?.resolvedModel === 'string' ? { model: output.resolvedModel as string } : {};
  if (text.startsWith(ASYNC_LAUNCH)) return () => ({ background: true, ...model });
  const usage = typeof output?.totalTokens === 'number' ? { tokens: output.totalTokens, toolUses: output.totalToolUseCount ?? 0, durationMs: output.totalDurationMs ?? 0 } : usageFrom(text);
  return (a) => ({ status: isError ? 'failed' : 'done', endedAt: now, ...model, ...(usage ? { usage } : { usage: a.usage }) });
};

export const replayText = (content: unknown) =>
  typeof content === 'string' ? content : Array.isArray(content) ? (content.find((b) => b?.type === 'text') as { text?: string } | undefined)?.text : undefined;
