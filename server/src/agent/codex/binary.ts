import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exec } from '../../exec.js';

// The server may run under launchd, whose PATH lacks the node version manager's bin directory.
export function codexBin(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  if (env.AGENTVIEW_CODEX) return env.AGENTVIEW_CODEX;
  const nvm = path.join(home, '.nvm', 'versions', 'node');
  const versions = existsSync(nvm) ? readdirSync(nvm).sort().reverse() : [];
  const dirs = [...(env.PATH ?? '').split(path.delimiter), ...versions.map((v) => path.join(nvm, v, 'bin')), '/opt/homebrew/bin', '/usr/local/bin'];
  return dirs.map((d) => path.join(d, 'codex')).find((f) => existsSync(f)) ?? 'codex';
}

export const NOT_SIGNED_IN = 'Run codex login on this Mac';

const TTL = 30_000;
let cached: { at: number; value: Promise<boolean> } | null = null;

// `codex login status` exits 0 only when a login is stored; the answer is kept briefly since settings read it on each load.
export function codexSignedIn(now = Date.now()): Promise<boolean> {
  if (cached && now - cached.at < TTL) return cached.value;
  const value = exec(codexBin(), ['login', 'status'], { timeout: 10_000 }).then(() => true, () => false);
  cached = { at: now, value };
  return value;
}
