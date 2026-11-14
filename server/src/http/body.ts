import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { readBytes, type Body } from '../json.js';

const PASTES = path.join(os.homedir(), '.agentview', 'pastes');
const PASTE_TTL = 7 * 24 * 60 * 60_000;

async function prunePastes(dir: string) {
  const cutoff = Date.now() - PASTE_TTL;
  for (const f of await readdir(dir)) {
    const file = path.join(dir, f);
    if ((await stat(file)).mtimeMs < cutoff) await unlink(file);
  }
}

export async function savePaste(req: Body, name: string, dir = PASTES) {
  const body = await readBytes(req, 50_000_000, 'Files over 50 MB cannot be attached');
  await mkdir(dir, { recursive: true });
  const safe = path.basename(name).replace(/[^\w.-]+/g, '-').slice(-80) || 'file';
  const file = path.join(dir, `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${randomUUID().slice(0, 6)}-${safe}`);
  await writeFile(file, body);
  void prunePastes(dir).catch(() => {});
  return file;
}
