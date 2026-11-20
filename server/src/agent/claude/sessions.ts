import path from 'node:path';
import { open, readdir, stat } from 'node:fs/promises';
import { providerOf } from '../registry.js';
import { getSessionInfo, listSessions as listAll, renameSession, type ListSessionsOptions, type SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import type { SavedSession } from '../../../../shared/protocol.js';
import { chatTitle } from '../../../../shared/util.js';
import { codexThread, noteThread } from '../codex/threads.js';
import { CLAUDE_DIR, projectDir } from './history.js';
import { failed } from '../../json.js';

export { getSessionInfo };

const statSig = (file: string) => stat(file).then((s) => `${s.ino}:${s.size}:${s.mtimeMs}`, () => '-');

// Every transcript and title file the SDK listing reads, by stat alone.
async function signature() {
  const root = path.join(CLAUDE_DIR, 'projects');
  const dirs = await readdir(root).catch(() => [] as string[]);
  const parts = await Promise.all(dirs.map(async (d) => {
    const files = (await readdir(path.join(root, d)).catch(() => [] as string[])).filter((f) => f.endsWith('.jsonl'));
    return Promise.all(files.map(async (f) => {
      const sigs = await Promise.all([statSig(path.join(root, d, f)), statSig(path.join(root, d, f.slice(0, -6), 'custom-title.json'))]);
      return `${d}/${f}:${sigs.join(':')}`;
    }));
  }));
  return parts.flat().join('\n');
}

const cache = new Map<string, { sig: string; list: Promise<SDKSessionInfo[]> }>();

// The SDK reads the head and tail of each listed transcript on every call; the result is kept until a file changes.
export async function listSessions(opts: ListSessionsOptions = {}) {
  if (opts.dir) return listAll(opts).then(ownTail);
  const key = JSON.stringify(opts);
  const sig = await signature();
  const hit = cache.get(key);
  if (hit?.sig === sig) return hit.list;
  const list = listAll(opts).then(ownTail);
  cache.set(key, { sig, list });
  list.catch(() => cache.get(key)?.list === list && cache.delete(key));
  return list;
}

// The time of the last user or assistant entry. Claude appends bookkeeping lines when a process exits, which move the file's mtime.
export function lastMessageTime(tail: string) {
  const lines = tail.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"timestamp"')) continue;
    try {
      const e = JSON.parse(lines[i]);
      if ((e.type === 'user' || e.type === 'assistant') && e.timestamp) return Date.parse(e.timestamp) || null;
    } catch {}
  }
  return null;
}

const TAIL = 256 * 1024;

export async function readTail(x: SDKSessionInfo) {
  if (!x.cwd) return '';
  const file = await open(path.join(projectDir(x.cwd), `${x.sessionId}.jsonl`)).catch(() => null);
  if (!file) return '';
  try {
    const { size } = await file.stat();
    const len = Math.min(size, TAIL);
    const buf = Buffer.alloc(len);
    await file.read(buf, 0, len, size - len);
    return buf.toString('utf8');
  } finally {
    await file.close();
  }
}

// The SDK takes gitBranch from the last transcript entry, which can be a subagent's in its own worktree. The chat's branch is the last entry outside a sidechain.
export function ownBranch(tail: string) {
  const lines = tail.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"gitBranch"') || lines[i].includes('"isSidechain":true')) continue;
    try {
      const b = JSON.parse(lines[i]).gitBranch;
      if (b) return b as string;
    } catch {}
  }
  return undefined;
}

const ownTail = (all: SDKSessionInfo[]) => Promise.all(all.map(async (x) => {
  const tail = await readTail(x);
  return { ...x, lastModified: lastMessageTime(tail) ?? x.lastModified, gitBranch: ownBranch(tail) };
}));

export function savedSession(x: SDKSessionInfo, summary?: string): SavedSession {
  const firstPrompt = x.firstPrompt?.replace(/\s+/g, ' ').trim().slice(0, 300);
  return { sessionId: x.sessionId, title: x.customTitle ? x.summary : chatTitle(x.summary.startsWith('@') && x.firstPrompt ? x.firstPrompt : x.summary), cwd: x.cwd ?? '', gitBranch: x.gitBranch ?? null, lastModified: x.lastModified, provider: providerOf(x.sessionId), ...(firstPrompt && { firstPrompt }), ...(summary && { summary }) };
}

export const renameRoute = async (id: string | null, title: unknown): Promise<{ status: number; body: unknown }> => {
  const text = typeof title === 'string' ? title.trim() : '';
  if (!id || !text) return failed(400, 'id and title are required');
  const codex = await codexThread(id);
  if (codex) {
    await noteThread(id, { ...codex, summary: text });
    return { status: 200, body: { ok: true } };
  }
  const info = await getSessionInfo(id);
  if (!info) return failed(404, 'Session not found');
  await renameSession(id, text, { dir: info.cwd });
  return { status: 200, body: { ok: true } };
};
