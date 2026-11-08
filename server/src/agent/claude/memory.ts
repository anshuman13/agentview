import path from 'node:path';
import { readdir, readFile, realpath } from 'node:fs/promises';
import { CLAUDE_DIR } from './history.js';
import { configDir } from './accounts.js';

export type MemoryFile = { path: string; name: string; description: string; text: string };

const MAX = 20_000;

// The repo's CLAUDE.md, then each account's own CLAUDE.md and its memory files for this folder, like Windsurf's memories panel.
export async function chatMemory(cwd: string, dirs = [CLAUDE_DIR, configDir('alt'), configDir('alt2')]): Promise<MemoryFile[]> {
  const slug = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  const files = [path.join(cwd, 'CLAUDE.md')];
  for (const dir of new Set(dirs.filter((d): d is string => !!d))) {
    const mem = path.join(dir, 'projects', slug, 'memory');
    const names = (await readdir(mem).catch(() => [])).filter((n) => n.endsWith('.md')).sort((a, b) => Number(b === 'MEMORY.md') - Number(a === 'MEMORY.md') || a.localeCompare(b));
    files.push(path.join(dir, 'CLAUDE.md'), ...names.map((n) => path.join(mem, n)));
  }
  const out: MemoryFile[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    // Account folders often link to the same files; list each once.
    const real = await realpath(file).catch(() => null);
    if (!real || seen.has(real)) continue;
    seen.add(real);
    const raw = await readFile(real, 'utf8').catch(() => null);
    if (raw === null) continue;
    const front = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
    const field = (k: string) => front?.[1].match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1].trim().replace(/^(["'])(.*)\1$/, '$2') ?? '';
    const text = raw.slice(front?.[0].length ?? 0).trim();
    out.push({ path: file, name: field('name') || path.basename(file), description: field('description'), text: text.length > MAX ? `${text.slice(0, MAX)}\n…` : text });
  }
  return out;
}
