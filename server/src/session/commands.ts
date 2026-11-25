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
];

// The provider's list keeps its own wording for a command both have.
export const withSessionCommands = (commands: SessionInfo['commands']) => [...commands, ...SESSION_COMMANDS.filter((c) => !commands.some((p) => p.name === c.name))];
