import type { ChatEvent, LiveAgent, LoopState, Repeat } from '../../../shared/protocol.js';
import type { Cron, RunningTask } from '../agent/types.js';
import { RUN_ID } from '../agent/claude/transcript.js';
import type { AgentSession } from '../session/session.js';

type StoppedTask = { description: string; tool: string; runId?: string; scriptPath?: string };
export type Stopped = { midTurn: boolean; tasks: StoppedTask[] };
export type Saved = { sessionId: string; crons: Cron[]; repeat?: Repeat | null; loop?: LoopState; queued?: { id: string; text: string }[]; stopped?: Stopped };

export const runningAgents = (chat: AgentSession): LiveAgent[] =>
  chat.state.events
    .filter((e): e is Extract<ChatEvent, { kind: 'agent' }> => e.kind === 'agent' && e.status === 'running')
    .map((e) => ({ id: e.toolUseId, description: e.description, ...(e.group && { group: e.group }), startedAt: e.startedAt }))
    .sort((a, b) => a.startedAt - b.startedAt);

// A long-running background task (a dev server, a watcher) holds a restart, blocks the orphan exit and keeps the chat open on purpose.
export const busy = (chat: AgentSession) =>
  chat.state.session.running || chat.state.session.compacting || runningAgents(chat).length > 0 || (chat.driver.runningTasks?.().length ?? 0) > 0;

export function stoppedOf(events: ChatEvent[], tasks: RunningTask[], midTurn: boolean): Stopped | undefined {
  if (!midTurn && !tasks.length) return undefined;
  return {
    midTurn,
    tasks: tasks.map(({ toolUseId, tool, description }) => {
      if (tool !== 'Workflow') return { description, tool };
      const call = events.find((e) => e.kind === 'tool_use' && e.id === toolUseId);
      const result = events.find((e) => e.kind === 'tool_result' && e.toolUseId === toolUseId);
      const runId = result?.kind === 'tool_result' ? result.text.match(RUN_ID)?.[1] : undefined;
      const scriptPath = call?.kind === 'tool_use' ? call.input.scriptPath : undefined;
      return { description, tool, ...(runId && { runId }), ...(typeof scriptPath === 'string' && { scriptPath }) };
    }),
  };
}

const wellFormed = (s: any): s is Stopped => Array.isArray(s?.tasks) && s.tasks.every((t: any) => typeof t?.description === 'string');

export const resumePrompt = ({ midTurn, tasks }: Stopped) => {
  const list = tasks.map((t) => `- ${t.tool}: ${t.description}${t.runId ? ` (run id ${t.runId})` : ''}${t.scriptPath ? ` (script ${t.scriptPath})` : ''}`).join('\n');
  const resume = list ? `\n\n${list}\n\nResume each Workflow by calling it again with resumeFromRunId set to its run id. Restart the other stopped tasks if they are still needed.` : '';
  return `The agent host restarted${list ? ', which ended the background work it was running' : ''}.${resume}${midTurn ? ' Carry on with the turn you were in.' : ''}`;
};

export function parseSaved(raw: string): { view?: string; chats: Saved[] } | null {
  let saved: any;
  try {
    saved = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(saved?.chats)) return null;
  const chats = saved.chats
    .filter((c: any) => typeof c?.sessionId === 'string')
    .map(({ stopped, ...c }: any) => ({ ...c, crons: Array.isArray(c.crons) ? c.crons : [], ...(wellFormed(stopped) && { stopped }) }));
  return { view: typeof saved.view === 'string' ? saved.view : undefined, chats };
}
