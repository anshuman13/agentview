import type http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

export async function readBody(req: http.IncomingMessage, max = 1_000_000) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    if ((size += chunk.length) > max) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const PASTES = path.join(os.homedir(), '.agentview', 'pastes');
export async function savePaste(req: http.IncomingMessage, name: string) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 50_000_000) throw new Error('Files over 50 MB cannot be attached');
    chunks.push(chunk);
  }
  await mkdir(PASTES, { recursive: true });
  const safe = path.basename(name).replace(/[^\w.-]+/g, '-').slice(-80) || 'file';
  const file = path.join(PASTES, `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${randomUUID().slice(0, 6)}-${safe}`);
  await writeFile(file, Buffer.concat(chunks));
  return file;
}
