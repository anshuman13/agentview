import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { exec } from '../exec.js';

const PORT_FILE = path.join(os.homedir(), 'Library/Application Support/Google/Chrome/DevToolsActivePort');
// The relay address carries its token. Terminals, Claude and MCP servers inherit process.env, so take it out first.
const CDP = process.env.CHROME_CDP;
delete process.env.CHROME_CDP;
const PROFILE = path.join(os.homedir(), '.agentview/chrome');
export const PROFILE_PORT = 9333;

export const ownProfile = () => existsSync(PROFILE);

// The Playwright MCP server that drives this Chrome, for chats and hub jobs.
export const ownChromeMcp = () => ({ type: 'stdio' as const, command: 'npx', args: ['-y', '@playwright/mcp@latest', '--cdp-endpoint', `http://127.0.0.1:${PROFILE_PORT}`] });


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
  return exec('pgrep', args).then(() => true, () => false);
}

export const openMac = (label: string, args: string[]) => void exec('open', args).catch((err) => console.error(`${label}:`, err.message));

export function launchProfile(...urls: string[]) {
  const args = [
    '-na', 'Google Chrome', '--args', `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PROFILE_PORT}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    ...urls,
  ];
  openMac('chrome profile', args);
}

// The HTTP status the relay answers for each reason Chrome cannot be reached; failure() reads it back.
export const REASON_STATUS = { nofda: 451, nochrome: 410, disabled: 404, denied: 403, timeout: 504 } as const;
export type Reason = keyof typeof REASON_STATUS;

// A refused connection means remote debugging is off when Chrome runs, and no Chrome otherwise.
export const refused = async (): Promise<Reason> => ((await chromeRunning()) ? 'disabled' : 'nochrome');

// Reads why a WebSocket to Chrome failed from the client's error message, which names the HTTP status it got.
export async function failure(err: Error) {
  if (/ECONNREFUSED|Failed to connect/.test(err.message)) return refused();
  for (const [reason, status] of Object.entries(REASON_STATUS)) if (new RegExp(`\\b${status}\\b`).test(err.message)) return reason as Reason;
  if (/handshake has timed out/i.test(err.message)) return 'timeout';
  return err.message;
}
