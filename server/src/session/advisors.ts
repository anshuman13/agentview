import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ADVISORS, type Advisor, type AdvisorId } from '../../../shared/advisors.js';
import { ADVISOR_HOME, ROOTS } from '../workspace/files.js';

const ROLES = path.join(import.meta.dirname, '../../advisors');

export const advisor = (id: AdvisorId) => ADVISORS.find((a) => a.id === id);

const memoryRules = (roots: string[]) => `## Projects
The user's projects are the folders under ${roots.join(' and ')}; you may read any of them. Ask which project when it is unclear.

## Memory
memory.md in this folder is your memory across conversations and is loaded below. When you learn something that should outlast this conversation (a decision, a priority, a project fact, a preference of the user), update it in the same turn. Keep it under 150 lines: one line per fact, grouped by project, dated, oldest facts removed when they no longer hold.

@memory.md
`;

const writeIfChanged = async (file: string, text: string) => {
  if ((await readFile(file, 'utf8').catch(() => null)) !== text) await writeFile(file, text);
};

// Writes the role and settings on every open, so an edited role reaches the next conversation; memory.md is the agent's own.
export async function prepareAdvisor(a: Advisor, roots = ROOTS, home = ADVISOR_HOME) {
  const dir = path.join(home, a.id);
  await mkdir(path.join(dir, '.claude'), { recursive: true });
  const role = await readFile(path.join(ROLES, `${a.id}.md`), 'utf8');
  await writeIfChanged(path.join(dir, 'CLAUDE.md'), `${role.trim()}\n\n${memoryRules(roots)}`);
  await writeIfChanged(path.join(dir, '.claude/settings.json'), `${JSON.stringify({ permissions: { additionalDirectories: roots } }, null, 2)}\n`);
  if (!existsSync(path.join(dir, 'memory.md'))) await writeFile(path.join(dir, 'memory.md'), `# ${a.name} memory\n`);
  return dir;
}
