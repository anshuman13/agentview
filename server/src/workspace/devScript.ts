import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const SCRIPTS = ['dev', 'start', 'serve'];
const RUNNERS: [string, string][] = [['bun.lock', 'bun run'], ['bun.lockb', 'bun run'], ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn']];

// The command that starts a repo's dev server: its first dev, start or serve script, run by the package manager its lockfile names.
export function devCommand(pkg: string, has: (file: string) => boolean): { script: string; command: string } | null {
  let scripts: Record<string, unknown> = {};
  try {
    scripts = JSON.parse(pkg)?.scripts ?? {};
  } catch {}
  const script = SCRIPTS.find((s) => typeof scripts[s] === 'string');
  if (!script) return null;
  const runner = RUNNERS.find(([lock]) => has(lock))?.[1] ?? 'npm run';
  return { script, command: `${runner} ${script}` };
}

export async function devScript(cwd: string) {
  const pkg = await readFile(path.join(cwd, 'package.json'), 'utf8').catch(() => '');
  return devCommand(pkg, (f) => existsSync(path.join(cwd, f)));
}
