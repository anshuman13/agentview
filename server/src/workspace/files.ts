import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inside } from '../../../shared/util.js';
import { git } from './git.js';

const HIDDEN = new Set(['node_modules', '.git', 'dist']);

const home = os.homedir();
export const ROOTS = (process.env.AGENTVIEW_ROOTS ?? '~/workspace:~/workspace_personal').split(':').filter(Boolean).map((r) => path.resolve(r.replace(/^~/, home)));
const PASEO_TREES = path.join(home, '.paseo/worktrees');

export const allowedFolder = (dir: string) => [...ROOTS, PASEO_TREES].some((r) => inside(dir, r) && dir !== r);

export async function listFiles(cwd: string): Promise<string[]> {
  try {
    return (await git(cwd, ['ls-files', '--cached', '--others', '--exclude-standard'])).split('\n').filter(Boolean).sort();
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
  const abs = safeResolve(cwd, rel);
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
      ? (await git(cwd, ['check-ignore', '--', ...items.map((i) => i.path)], [0, 1]).catch(() => '')).split('\n')
      : [],
  );
  return items
    .map((i) => ({ name: i.name, dir: i.dir, hidden: HIDDEN.has(i.name) || ignored.has(i.path) }))
    .sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })));
}

export function safeResolve(cwd: string, rel: string): string {
  const abs = path.resolve(cwd, rel);
  if (!inside(abs, path.resolve(cwd))) throw new Error('path outside project');
  return abs;
}

const DENIED = ['.ssh', '.gnupg', '.aws', '.netrc', '.config/gcloud'];

const real = (p: string) => realpath(p).catch(() => path.resolve(p));

// Files the viewer shows: project-relative paths, or absolute paths anywhere. The path is resolved through
// symlinks first and refused if the resolved path passes through a credential folder, so a link into one fails too.
async function viewPath(cwd: string, p: string): Promise<string> {
  if (!path.isAbsolute(p)) safeResolve(cwd, p);
  const abs = await real(path.resolve(cwd, p));
  const joined = `/${abs.split(path.sep).join('/')}/`;
  if (DENIED.some((d) => joined.includes(`/${d}/`))) throw new Error('path is not viewable');
  return abs;
}

const MAX_FILE = 5_000_000;

const IMAGES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', avif: 'image/avif' };

export async function readImage(cwd: string, rel: string) {
  const type = IMAGES[path.extname(rel).slice(1).toLowerCase()];
  if (!type) throw new Error('not an image');
  const abs = await viewPath(cwd, rel);
  if ((await stat(abs)).size > 50_000_000) throw new Error('image too large');
  return { type, body: await readFile(abs) };
}

export async function readFileWithOriginal(cwd: string, rel: string) {
  const abs = await viewPath(cwd, rel);
  const size = await stat(abs).then((s) => s.size).catch(() => 0);
  if (size > MAX_FILE) throw new Error(`File is ${Math.round(size / 1e6)} MB, too large to show`);
  const content = await readFile(abs, 'utf8').catch(() => '');
  const original = await git(path.dirname(abs), ['show', `HEAD:./${path.basename(abs)}`]).catch(() => '');
  return { path: rel, content, original };
}
