import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The files Codex reads as instructions: the repo's AGENTS.md (CLAUDE.md when there is none, as the thread config sets), then the user's own.
export function codexInstructionFiles(cwd: string, home = os.homedir()): string[] {
  const agents = path.join(cwd, 'AGENTS.md');
  return [existsSync(agents) ? agents : path.join(cwd, 'CLAUDE.md'), path.join(home, '.codex', 'AGENTS.md')];
}
