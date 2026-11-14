import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
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

export const readJson = <T>(file: string, fallback: T): Promise<T> => readFile(file, 'utf8').then(JSON.parse).catch(() => fallback);

export function jsonFile<T>(file: string, fallback: T) {
  let lock: Promise<unknown> = Promise.resolve();
  const serial = <R>(f: () => Promise<R>): Promise<R> => {
    const run = lock.then(f, f);
    lock = run.catch(() => undefined);
    return run;
  };
  return {
    read: () => serial(() => readJson<T>(file, fallback)),
    clear: () => serial(() => rm(file, { force: true })),
    update: (fn: (cur: T) => T | Promise<T>) => serial(async () => {
      const cur = await readJson<T>(file, fallback);
      const next = await fn(cur);
      if (next !== cur) await writeJson(file, next, { pretty: true });
      return next;
    }),
  };
}

export function readJsonSync<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// A route's error reply.
export const failed = (status: number, error: string) => ({ status, body: { error } });

export class BadRequest extends Error {
  status = 400;
}

export class NotFound extends Error {
  status = 404;
}

export function parseObject(raw: string): Record<string, any> {
  if (!raw.trim()) return {};
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    throw new BadRequest('Request body is not valid JSON');
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new BadRequest('Request body must be a JSON object');
  return v as Record<string, any>;
}

// A frame that is not a JSON object is ignored, so null or a bare number cannot throw in a handler.
export function parseFrame<T extends object>(raw: unknown): T | null {
  try {
    const m: unknown = JSON.parse(String(raw));
    return m && typeof m === 'object' && !Array.isArray(m) ? (m as T) : null;
  } catch {
    return null;
  }
}
