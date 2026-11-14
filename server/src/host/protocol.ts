import type { AdvisorId } from '../../../shared/advisors.js';
import type { ChatRun, ClientMessage, LiveChat, Provider } from '../../../shared/protocol.js';

export type HostRequest =
  | { op: 'hello' }
  | { op: 'tool_call'; id: string; name: string; args: unknown }
  | { op: 'state'; id: string; limit?: number }
  | { op: 'events_before'; id: string; before: string; limit?: number }
  | { op: 'cmd'; id: string; msg: ClientMessage }
  | { op: 'open'; sessionId: string }
  | { op: 'advisor'; id: AdvisorId; fresh: boolean; text?: string }
  | { op: 'new'; cwd: string; from: string; fork?: string; model?: string; provider?: Provider; text?: string }
  | { op: 'job'; cwd: string; title: string; prompt: string; jobId: string; branch: string; repo: string; paseo: boolean }
  | { op: 'run_end'; id: string; why: string; pr?: string }
  | { op: 'run_revise'; id: string; text: string }
  | { op: 'close'; id: string }
  | { op: 'rename'; sessionId: string; title: string }
  | { op: 'ask'; cwd: string; prompt: string; from?: string; fresh?: boolean }
  | { op: 'mcp_add'; id: string; name: string }
  | { op: 'mcp_login'; id: string; name: string }
  | { op: 'viewers'; counts: Record<string, number>; last: string }
  | { op: 'desktop'; at: number }
  | { op: 'restart'; now: boolean; force: boolean };

export type Hello = { last: string; restarting: boolean; chats: LiveChat[]; runs: ChatRun[] };
