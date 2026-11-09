import type { ChatRun, LiveChat } from '../../../shared/protocol.js';
import { sumEdits } from '../../../shared/edits.js';
import type { AgentSession } from '../session/session.js';

// sumEdits walks every event; tool_use inputs and results are never edited in place, so identity + length is a safe key.
const editsCache = new WeakMap<AgentSession, { events: unknown[]; length: number; edits: ReturnType<typeof sumEdits> }>();
export function editsOf(chat: AgentSession) {
  const { events } = chat.state;
  const hit = editsCache.get(chat);
  if (hit?.events === events && hit.length === events.length) return hit.edits;
  const edits = sumEdits(events);
  editsCache.set(chat, { events, length: events.length, edits });
  return edits;
}

export function runField(run: ChatRun | undefined): Pick<LiveChat, 'run'> {
  if (!run) return {};
  const last = run.rounds.at(-1);
  return { run: { id: run.id, kind: run.kind, state: run.state, ...(run.why && { why: run.why }), nextAt: run.nextAt, round: run.round, needsYou: run.needsYou, ...(last && { outcome: last.outcome, line: last.line }) } };
}
