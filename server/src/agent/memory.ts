import path from 'node:path';
import { link, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';

export type MemoryFile = { path: string; name: string; description: string; text: string; editable: boolean; at: number };

const MAX = 20_000;
const INDEX = 'MEMORY.md';
const REFUSED = 'Not a memory file you can edit';

// A .md file directly inside <account>/projects/<slug>/memory, as chatMemory lists them; never an instruction file.
const isMemoryPath = (real: string) => {
  const dir = path.dirname(real);
  return real.endsWith('.md') && !['CLAUDE.md', 'AGENTS.md'].includes(path.basename(real)) && path.basename(dir) === 'memory' && path.basename(path.dirname(path.dirname(dir))) === 'projects';
};

const frontOf = (raw: string) => /^---\n([\s\S]*?)\n---\n?/.exec(raw);

// A MEMORY.md line that links to the file, as `[title](name.md)` or `[title](./name.md)`.
const linksTo = (line: string, name: string) => line.includes(`](${name})`) || line.includes(`](./${name})`);

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
    const at = (await stat(real).catch(() => null))?.mtimeMs ?? 0;
    const front = frontOf(raw);
    const field = (k: string) => front?.[1].match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1].trim().replace(/^(["'])(.*)\1$/, '$2') ?? '';
    const text = raw.slice(front?.[0].length ?? 0).trim();
    out.push({ path: file, name: field('name') || path.basename(file), description: field('description'), text: text.length > MAX ? `${text.slice(0, MAX)}\n…` : text, editable: isMemoryPath(real) && text.length <= MAX, at: Math.round(at) });
  }
  return out;
}

// The real path of a file that is editable in `files`; anything else throws.
async function editableReal(files: MemoryFile[], file: string) {
  const real = await realpath(file).catch(() => null);
  if (!real || !isMemoryPath(real)) throw new Error(REFUSED);
  for (const f of files) if (f.editable && (await realpath(f.path).catch(() => null)) === real) return real;
  throw new Error(REFUSED);
}

// Writes through a temp file in the same folder, so no reader sees half a file; `fresh` refuses a file that is there.
async function writeWhole(real: string, text: string, fresh = false) {
  const tmp = path.join(path.dirname(real), `.${path.basename(real)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(tmp, text, { encoding: 'utf8', flag: 'wx' });
    await (fresh ? link(tmp, real) : rename(tmp, real));
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

// The folder's MEMORY.md, or null when it links out of the folder.
async function indexIn(dir: string) {
  const index = path.join(dir, INDEX);
  const real = await realpath(index).catch(() => index);
  return path.dirname(real) === dir ? real : null;
}

// Replaces the body of a file that is editable in `files`, keeping its front matter; returns the previous body.
export async function saveMemory(files: MemoryFile[], file: string, text: string): Promise<{ previous: string }> {
  if (text.length > MAX) throw new Error(REFUSED);
  const real = await editableReal(files, file);
  const raw = await readFile(real, 'utf8');
  const head = frontOf(raw)?.[0] ?? '';
  const body = raw.slice(head.length);
  await writeWhole(real, `${head}${/^\s*/.exec(body)![0]}${text.trim()}\n`);
  return { previous: body.trim() };
}

// Deletes a memory file that is editable in `files` (never MEMORY.md) and the MEMORY.md lines that link to it; returns both so restoreMemory can put them back.
export async function removeMemory(files: MemoryFile[], file: string): Promise<{ raw: string; lines: string[] }> {
  const real = await editableReal(files, file);
  const name = path.basename(real);
  if (name === INDEX) throw new Error(REFUSED);
  const raw = await readFile(real, 'utf8');
  const index = await indexIn(path.dirname(real));
  const text = index ? await readFile(index, 'utf8').catch(() => '') : '';
  const lines = text.split('\n').filter((l) => linksTo(l, name));
  await unlink(real);
  try {
    if (lines.length) await writeWhole(index!, text.split('\n').filter((l) => !linksTo(l, name)).join('\n'));
  } catch (e) {
    await writeWhole(real, raw, true);
    throw e;
  }
  return { raw, lines };
}

// Writes a removed memory file back into one of `dirs` when no file of that name is there, and adds its MEMORY.md lines that are missing.
export async function restoreMemory(dirs: string[], file: string, raw: string, lines: string[]): Promise<{ ok: true }> {
  const name = path.basename(file);
  const dir = await realpath(path.dirname(file)).catch(() => null);
  const allowed = await Promise.all(dirs.map((d) => realpath(d).catch(() => null)));
  const refused = !dir || !allowed.includes(dir) || name === INDEX || !isMemoryPath(path.join(dir, name)) || raw.length > 2 * MAX || lines.some((l) => l.includes('\n') || !linksTo(l, name));
  if (refused) throw new Error('Not a memory file you can restore');
  const real = path.join(dir, name);
  await writeWhole(real, raw, true);
  const index = await indexIn(dir);
  if (!index) return { ok: true };
  const text = await readFile(index, 'utf8').catch(() => '');
  const have = text.split('\n');
  const add = lines.filter((l, i) => !have.includes(l) && lines.indexOf(l) === i);
  if (add.length) await writeWhole(index, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${add.join('\n')}\n`);
  return { ok: true };
}
