import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const exec = promisify(execFile);
const HIDDEN = new Set(['node_modules', '.git', 'dist']);

export async function listFiles(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await exec('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout.split('\n').filter(Boolean).sort();
  } catch {
    return walk(cwd, '');
  }
}

async function walk(root: string, rel: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(path.join(root, rel), { withFileTypes: true });
  for (const e of entries) {
    if (HIDDEN.has(e.name)) continue;
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(root, p)));
    else out.push(p);
  }
  return out;
}

export async function listDir(cwd: string, rel: string) {
  const abs = await realResolve(cwd, rel);
  const entries = await readdir(abs, { withFileTypes: true });
  const items = await Promise.all(
    entries.map(async (e) => ({
      name: e.name,
      path: rel ? `${rel}/${e.name}` : e.name,
      dir: e.isDirectory() || (e.isSymbolicLink() && !!(await stat(path.join(abs, e.name)).catch(() => null))?.isDirectory()),
    })),
  );
  const ignored = new Set(
    items.length
      ? (await exec('git', ['check-ignore', '--', ...items.map((i) => i.path)], { cwd }).catch((e) => e)).stdout?.split('\n') ?? []
      : [],
  );
  return items
    .map((i) => ({ name: i.name, dir: i.dir, hidden: HIDDEN.has(i.name) || ignored.has(i.path) }))
    .sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })));
}

const within = (file: string, root: string) => file === root || file.startsWith(root + path.sep);

export function safeResolve(cwd: string, rel: string): string {
  const abs = path.resolve(cwd, rel);
  if (!within(abs, path.resolve(cwd))) throw new Error('path outside project');
  return abs;
}

// Like safeResolve, and also refuses symlinks that lead out of the project.
async function realResolve(cwd: string, rel: string) {
  const abs = safeResolve(cwd, rel);
  const [real, root] = await Promise.all([realpath(abs).catch(() => abs), realpath(cwd).catch(() => path.resolve(cwd))]);
  if (!within(real, root)) throw new Error('path outside project');
  return abs;
}

const MAX_FILE = 5_000_000;

const IMAGES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', avif: 'image/avif' };

export async function readImage(cwd: string, rel: string) {
  const type = IMAGES[path.extname(rel).slice(1).toLowerCase()];
  if (!type) throw new Error('not an image');
  const abs = await realResolve(cwd, rel);
  if ((await stat(abs)).size > 50_000_000) throw new Error('image too large');
  return { type, body: await readFile(abs) };
}

export async function readFileWithOriginal(cwd: string, rel: string) {
  const abs = await realResolve(cwd, rel);
  const size = await stat(abs).then((s) => s.size).catch(() => 0);
  if (size > MAX_FILE) throw new Error(`File is ${Math.round(size / 1e6)} MB, too large to show`);
  const content = await readFile(abs, 'utf8').catch(() => '');
  const original = await exec('git', ['show', `HEAD:./${rel}`], { cwd, maxBuffer: MAX_FILE }).then((r) => r.stdout, () => '');
  return { path: rel, content, original };
}
