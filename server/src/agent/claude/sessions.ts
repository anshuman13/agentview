import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { listSessions as listAll, type ListSessionsOptions, type SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import { CLAUDE_DIR } from './history.js';

export { getSessionInfo } from '@anthropic-ai/claude-agent-sdk';

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
  if (opts.dir) return listAll(opts);
  const key = JSON.stringify(opts);
  const sig = await signature();
  const hit = cache.get(key);
  if (hit?.sig === sig) return hit.list;
  const list = listAll(opts);
  cache.set(key, { sig, list });
  list.catch(() => cache.get(key)?.list === list && cache.delete(key));
  return list;
}
