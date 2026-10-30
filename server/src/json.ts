import { randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Written to a temp file and renamed over the old one, so a crash or a second writer never leaves half a file.
const tmpOf = (file: string) => `${file}.${process.pid}.${randomUUID()}.tmp`;

export async function writeJson(file: string, data: unknown, opts: { pretty?: boolean; mode?: number } = {}) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = tmpOf(file);
  try {
    await writeFile(tmp, JSON.stringify(data, null, opts.pretty ? 2 : undefined) + (opts.pretty ? '\n' : ''), { mode: opts.mode });
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

export function writeJsonSync(file: string, data: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = tmpOf(file);
  try {
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}
