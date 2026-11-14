import { buildStageOf } from '../../../shared/builds.js';
import type { ChatEvent, LiveAgent, LoopState, Repeat } from '../../../shared/protocol.js';
import type { Cron, RunningTask } from '../agent/types.js';
import { RUN_ID } from '../agent/claude/transcript.js';
import type { Stopped } from '../session/resume.js';
import type { AgentSession } from '../session/session.js';

export type Saved = { sessionId: string; crons: Cron[]; repeat?: Repeat | null; loop?: LoopState; queued?: { id: string; text: string }[]; stopped?: Stopped };

export const runningAgents = (chat: AgentSession) => liveAgents(chat.state.events);

export const liveAgents = (events: ChatEvent[]): LiveAgent[] =>
  events
    .filter((e): e is Extract<ChatEvent, { kind: 'agent' }> => e.kind === 'agent' && e.status === 'running')
    .map((e) => {
      const slug = buildStageOf(e.subagentType, e.description, e.prompt)?.slug;
      return { id: e.toolUseId, description: e.description, type: e.subagentType, ...(slug && { slug }), ...(e.group && { group: e.group }), startedAt: e.startedAt };
    })
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
