import { MCP_BAD, type ChatEvent, type LiveChat } from '../../../shared/protocol.js';
import { chatTitle } from '../../../shared/util.js';
import { replyLine } from '../../../shared/edits.js';
import { latestTodos, todoCount } from '../../../shared/todos.js';
import { prChecks } from '../integrations/github.js';
import type { AgentSession } from '../session/session.js';
import { costsOf, modelField } from './summaryCache.js';
import { liveAgents } from './restore.js';
import { editsOf, runField } from './liveFields.js';

export const lastActive = (chat: AgentSession) => chat.state.events.at(-1)?.at ?? chat.created;

type Of<K extends ChatEvent['kind']> = Extract<ChatEvent, { kind: K }>;
type Scan = { events: ChatEvent[]; length: number; status?: Of<'status'>; firstUser?: Of<'user'>; agents: Of<'agent'>[] };
const scans = new WeakMap<AgentSession, Scan>();

// Events are appended in place; a trim, removal or reload swaps the array, which starts the scan over.
function scanOf(chat: AgentSession) {
  const { events } = chat.state;
  let s = scans.get(chat);
  if (!s || s.events !== events || s.length > events.length) {
    s = { events, length: 0, agents: [] };
    scans.set(chat, s);
  }
  for (let i = s.length; i < events.length; i++) {
    const e = events[i];
    if (e.kind === 'status') s.status = e;
    else if (e.kind === 'user') s.firstUser ??= e;
    else if (e.kind === 'agent') s.agents.push(e);
  }
  s.length = events.length;
  return s;
}

function nowField(e: Of<'status'> | undefined) {
  return e ? { now: { text: e.text, at: e.at, ...(e.done && { done: e.done }), ...(e.next && { next: e.next }) } } : {};
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
  const scan = scanOf(chat);
  const agentList = liveAgents(scan.agents);
  const firstPrompt = scan.firstUser;
  const { cost, spend } = costsOf(s.events, new Date().setHours(0, 0, 0, 0));
  return {
    id: chat.id,
    sessionId: s.session.sessionId,
    cwd: chat.cwd,
    title: chat.title || (firstPrompt ? chatTitle(firstPrompt.text) : 'New chat'),
    running: s.session.running,
    agents: agentList.length,
    ...(agentList.length > 0 && { agentList }),
    ...nowField(scan.status),
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
    ...runField(run),
  };
}
