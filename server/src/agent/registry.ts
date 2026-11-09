import path from 'node:path';
import type { Provider } from '../../../shared/protocol.js';
import { readJsonSync, writeJsonSync } from '../json.js';
import { STATE_DIR, loggedInAccounts, verifyLimit } from './claude/accounts.js';
import { claudeDriver } from './claude/driver.js';
import type { DriverFactory } from './types.js';

type Entry = {
  driver(cwd: string, resume?: string, fork?: boolean): DriverFactory;
  // Clears a limit mark the provider no longer deserves, so a chat does not start on a wrong one.
  verifyLimits(): Promise<unknown>;
};

const PROVIDERS: Record<Provider, Entry> = {
  claude: {
    driver: (cwd, resume, fork) => claudeDriver(cwd, resume, fork),
    verifyLimits: () => Promise.all(loggedInAccounts().map((a) => verifyLimit(a))),
  },
  openrouter: {
    driver: (cwd, resume, fork) => claudeDriver(cwd, resume, fork, true),
    verifyLimits: () => Promise.resolve(),
  },
};

export const provider = (id: Provider) => PROVIDERS[id];

// The provider each chat was last on, so a reopened chat goes back to it; a chat not listed runs on Claude.
const FILE = path.join(STATE_DIR, 'chat-providers.json');
const chatProviders: Record<string, Provider> = readJsonSync<Record<string, Provider> | null>(FILE, null) ?? {};

export function rememberProvider(sessionId: string, p: Provider) {
  if ((chatProviders[sessionId] ?? 'claude') === p) return;
  chatProviders[sessionId] = p;
  try {
    writeJsonSync(FILE, chatProviders);
  } catch {}
}

export function providerOf(sessionId: string | undefined): Provider {
  const p = sessionId ? chatProviders[sessionId] : undefined;
  return p && p in PROVIDERS ? p : 'claude';
}
