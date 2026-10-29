import type http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';

export async function readBody(req: http.IncomingMessage, max = 1_000_000) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    if ((size += chunk.length) > max) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export class BadRequest extends Error {
  status = 400;
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

const PASTES = path.join(os.homedir(), '.agentview', 'pastes');
const PASTE_TTL = 7 * 24 * 60 * 60_000;

async function prunePastes(dir: string) {
  const cutoff = Date.now() - PASTE_TTL;
  for (const f of await readdir(dir)) {
    const file = path.join(dir, f);
    if ((await stat(file)).mtimeMs < cutoff) await unlink(file);
  }
}

export async function savePaste(req: http.IncomingMessage, name: string, dir = PASTES) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 50_000_000) throw new Error('Files over 50 MB cannot be attached');
    chunks.push(chunk);
  }
  await mkdir(dir, { recursive: true });
  const safe = path.basename(name).replace(/[^\w.-]+/g, '-').slice(-80) || 'file';
  const file = path.join(dir, `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${randomUUID().slice(0, 6)}-${safe}`);
  await writeFile(file, Buffer.concat(chunks));
  void prunePastes(dir).catch(() => {});
  return file;
}
