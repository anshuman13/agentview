import path from 'node:path';
import { readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';

export type MemoryFile = { path: string; name: string; description: string; text: string; editable: boolean };

const MAX = 20_000;

// A .md file directly inside <account>/projects/<slug>/memory, as chatMemory lists them; never an instruction file.
const isMemoryPath = (real: string) => {
  const dir = path.dirname(real);
  return real.endsWith('.md') && !['CLAUDE.md', 'AGENTS.md'].includes(path.basename(real)) && path.basename(dir) === 'memory' && path.basename(path.dirname(path.dirname(dir))) === 'projects';
};

const frontOf = (raw: string) => /^---\n([\s\S]*?)\n---\n?/.exec(raw);

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
    const front = frontOf(raw);
    const field = (k: string) => front?.[1].match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1].trim().replace(/^(["'])(.*)\1$/, '$2') ?? '';
    const text = raw.slice(front?.[0].length ?? 0).trim();
    out.push({ path: file, name: field('name') || path.basename(file), description: field('description'), text: text.length > MAX ? `${text.slice(0, MAX)}\n…` : text, editable: isMemoryPath(real) && text.length <= MAX });
  }
  return out;
}

// Replaces the body of a file that is editable in `files`, keeping its front matter; returns the previous body.
export async function saveMemory(files: MemoryFile[], file: string, text: string): Promise<{ previous: string }> {
  const real = await realpath(file).catch(() => null);
  if (!real || !isMemoryPath(real) || text.length > MAX) throw new Error('Not a memory file you can edit');
  let listed = false;
  for (const f of files) if (f.editable && (await realpath(f.path).catch(() => null)) === real) listed = true;
  if (!listed) throw new Error('Not a memory file you can edit');
  const raw = await readFile(real, 'utf8');
  const head = frontOf(raw)?.[0] ?? '';
  const body = raw.slice(head.length);
  const tmp = path.join(path.dirname(real), `.${path.basename(real)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(tmp, `${head}${/^\s*/.exec(body)![0]}${text.trim()}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(tmp, real);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
  return { previous: body.trim() };
}
