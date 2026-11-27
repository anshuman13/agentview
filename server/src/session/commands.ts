import type { SessionInfo } from '../../../shared/protocol.js';
import { SKETCH_COMMAND } from '../../../shared/sketches.js';
import { BUILD_COMMAND } from '../../../shared/build.js';
import { SPEC_REVIEW_COMMAND } from '../../../shared/specTasks.js';

// The commands the session runs itself, whatever the provider; offered in every chat next to the provider's own.
export const SESSION_COMMANDS: SessionInfo['commands'] = [
  { name: 'tries', description: 'Run a prompt in several worktrees at once' },
  BUILD_COMMAND,
  { name: 'compact', description: 'Compact the conversation' },
  { name: 'code-review', description: 'Review the working tree or a PR' },
  SKETCH_COMMAND,
  { name: SPEC_REVIEW_COMMAND, description: 'Review a spec with a cold reader and a readiness check' },
  { name: 'subtask', description: 'Fork this chat to work on a task while you stay here' },
];

// /subtask forks the chat, so a provider that cannot fork does not offer it.
export const sessionCommands = (canFork: boolean) => (canFork ? SESSION_COMMANDS : SESSION_COMMANDS.filter((c) => c.name !== 'subtask'));

// The provider's list keeps its own wording for a command both have.
export const withSessionCommands = (commands: SessionInfo['commands'], canFork = true) => [...commands, ...sessionCommands(canFork).filter((c) => !commands.some((p) => p.name === c.name))];

// "/subtask <task>": the task, '' for a bare /subtask, null for any other text.
export function parseSubtask(text: string) {
  const m = text.trim().match(/^\/subtask(?:\s+([\s\S]*))?$/);
  return m ? (m[1] ?? '').trim() : null;
}
