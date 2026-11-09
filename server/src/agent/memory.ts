import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';

export type MemoryFile = { path: string; name: string; description: string; text: string };

const MAX = 20_000;

// The files as the Memory list shows them; one that is missing or linked twice is skipped.
export async function readMemory(files: string[]): Promise<MemoryFile[]> {
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
