import { MCP_BAD, type ChatEvent, type LiveChat } from '../../../shared/protocol.js';
import { chatTitle } from '../../../shared/util.js';
import { recapOf, replyLine } from '../../../shared/edits.js';
import { latestTodos, todoCount } from '../../../shared/todos.js';
import { prChecks } from '../integrations/github.js';
import type { AgentSession } from '../session/session.js';
import { costsOf, modelField } from './summaryCache.js';
import { runningAgents } from './restore.js';
import { editsOf, runField } from './liveFields.js';

export const lastActive = (chat: AgentSession) => chat.state.events.at(-1)?.at ?? chat.created;

function nowField(events: ChatEvent[]) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind === 'status') return { now: { text: e.text, at: e.at, ...(e.done && { done: e.done }), ...(e.next && { next: e.next }) } };
  }
  return {};
}

type SummaryInputs = { stalled: boolean; run: Parameters<typeof runField>[0]; refresh: () => void };

function prChecksField(cwd: string, pr: number, refresh: () => void) {
  const checks = prChecks(cwd, pr, refresh);
  return checks && checks !== 'none' ? { prChecks: checks } : {};
}

export function summary(chat: AgentSession, { stalled, run, refresh }: SummaryInputs): LiveChat {
  const s = chat.state;
  const todos = latestTodos(s.events);
  const progress = todos && todoCount(todos);
  const recap = recapOf(s.events, s.session.running);
  const agentList = runningAgents(chat);
  const firstPrompt = s.events.find((e) => e.kind === 'user');
  const { cost, spend } = costsOf(s.events, new Date().setHours(0, 0, 0, 0));
  return {
    id: chat.id,
    sessionId: s.session.sessionId,
    cwd: chat.cwd,
    title: chat.title || (firstPrompt?.kind === 'user' ? chatTitle(firstPrompt.text) : 'New chat'),
    running: s.session.running,
    agents: agentList.length,
    ...(agentList.length > 0 && { agentList }),
    ...nowField(s.events),
    pending: s.pending.length,
    status: s.status,
    lastActive: lastActive(chat),
    mcpFailed: s.session.mcp.filter((m) => MCP_BAD.includes(m.status)).length,
    cost,
    ...(Object.keys(spend.week).length > 0 && { spend }),
    stalled,
    ...(chat.failed && { failed: true }),
    ...modelField(s.session.model),
    ...(s.session.provider && { provider: s.session.provider }),
    last: replyLine(s.events),
    edits: editsOf(chat),
    ...(s.session.pr && { pr: s.session.pr, ...prChecksField(chat.cwd, s.session.pr, refresh) }),
    ...(progress && progress.done < progress.total && { todos: progress }),
    ...(recap && { recap }),
    ...runField(run),
  };
}
