import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';

const PORT_FILE = path.join(os.homedir(), 'Library/Application Support/Google/Chrome/DevToolsActivePort');
// The relay address carries its token. Terminals, Claude and MCP servers inherit process.env, so take it out first.
const CDP = process.env.CHROME_CDP;
delete process.env.CHROME_CDP;
const PROFILE = path.join(os.homedir(), '.agentview/chrome');
const PROFILE_PORT = 9333;

export const ownProfile = () => existsSync(PROFILE);


export async function endpoint() {
  if (CDP) return CDP;
  if (ownProfile()) {
    try {
      const r = await fetch(`http://127.0.0.1:${PROFILE_PORT}/json/version`, { signal: AbortSignal.timeout(3000) });
      const url = ((await r.json()) as { webSocketDebuggerUrl: string }).webSocketDebuggerUrl;
      if (!url.startsWith(`ws://127.0.0.1:${PROFILE_PORT}/`)) throw new Error('disabled');
      return url;
    } catch {
      throw new Error((await chromeRunning()) ? 'disabled' : 'nochrome');
    }
  }
  try {
    const [port, p] = (await readFile(PORT_FILE, 'utf8')).trim().split('\n');
    return `ws://127.0.0.1:${port}${p}`;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EPERM' || code === 'EACCES') throw new Error('nofda');
    throw new Error((await chromeRunning()) ? 'disabled' : 'nochrome');
  }
}

export function chromeRunning() {
  if (process.platform !== 'darwin') return Promise.resolve(true);
  const args = ownProfile() ? ['-f', `--user-data-dir=${PROFILE}`] : ['-x', 'Google Chrome'];
  return new Promise<boolean>((resolve) => execFile('pgrep', args, (err) => resolve(!err)));
}

export function launchProfile(...urls: string[]) {
  const args = [
    '-na', 'Google Chrome', '--args', `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PROFILE_PORT}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    ...urls,
  ];
  execFile('open', args, (err) => err && console.error('chrome profile:', err.message));
}

export async function failure(err: NodeJS.ErrnoException) {
  if (err.code === 'ECONNREFUSED') return (await chromeRunning()) ? 'disabled' : 'nochrome';
  if (/\b403\b/.test(err.message)) return 'denied';
  if (/\b404\b/.test(err.message)) return 'disabled';
  if (/\b410\b/.test(err.message)) return 'nochrome';
  if (/\b451\b/.test(err.message)) return 'nofda';
  if (/\b504\b/.test(err.message)) return 'timeout';
  if (/handshake has timed out/i.test(err.message)) return 'timeout';
  return err.message;
}
