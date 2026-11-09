import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { CLAUDE_DIR } from './history.js';
import { configDir } from './accounts.js';
import { readMemory, type MemoryFile } from '../memory.js';

const accountDirs = (dirs: Array<string | undefined>) => [...new Set(dirs.filter((d): d is string => !!d))];
const ACCOUNTS = () => [CLAUDE_DIR, configDir('alt'), configDir('alt2')];

// The files Claude reads as instructions: the repo's CLAUDE.md, then each account's own.
export const claudeInstructionFiles = (cwd: string, dirs = ACCOUNTS()) => [path.join(cwd, 'CLAUDE.md'), ...accountDirs(dirs).map((d) => path.join(d, 'CLAUDE.md'))];

// The repo's CLAUDE.md, then each account's own CLAUDE.md and its memory files for this folder, like Windsurf's memories panel.
export async function chatMemory(cwd: string, dirs = ACCOUNTS()): Promise<MemoryFile[]> {
  const slug = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  const files = [path.join(cwd, 'CLAUDE.md')];
  for (const dir of accountDirs(dirs)) {
    const mem = path.join(dir, 'projects', slug, 'memory');
    const names = (await readdir(mem).catch(() => [])).filter((n) => n.endsWith('.md')).sort((a, b) => Number(b === 'MEMORY.md') - Number(a === 'MEMORY.md') || a.localeCompare(b));
    files.push(path.join(dir, 'CLAUDE.md'), ...names.map((n) => path.join(mem, n)));
  }
  return readMemory(files);
}
