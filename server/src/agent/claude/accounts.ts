import os from 'node:os';
import path from 'node:path';
import { statSync } from 'node:fs';
import type { Account } from '../../../../shared/protocol.js';
import { readJsonSync, writeJsonSync } from '../../json.js';

const ALT_DIR = process.env.AGENTVIEW_ALT_CLAUDE || path.join(os.homedir(), '.claude-alt');
const LIMITS = path.join(process.env.AGENTVIEW_LIMITS_DIR ?? path.join(os.homedir(), '.agentview'), 'limits.json');
const CHATS = path.join(path.dirname(LIMITS), 'chat-accounts.json');

type Limits = Partial<Record<Account, number>>;

// Until when each account is out of usage, kept across restarts. The hub marks limits in the same file, so it is read each time.
const limited: Limits = {};
const limits = (): Limits => readJsonSync<Limits | null>(LIMITS, null) ?? {};
export const limitedUntil = (a: Account) => Math.max(limits()[a] ?? 0, limited[a] ?? 0);

// The second account counts once it is logged in. The file is large, so it is read again only when it changes.
let altSeen = { mtime: -1, value: false };
export function hasAlt() {
  const file = path.join(ALT_DIR, '.claude.json');
  let mtime = 0;
  try {
    mtime = statSync(file).mtimeMs;
  } catch {}
  if (mtime !== altSeen.mtime) altSeen = { mtime, value: Boolean(mtime && readJsonSync<{ oauthAccount?: unknown } | null>(file, null)?.oauthAccount) };
  return altSeen.value;
}

export const configDir = (a: Account) => (a === 'alt' ? ALT_DIR : undefined);

const usable = (a: Account, now: number) => (a === 'main' || hasAlt()) && limitedUntil(a) <= now;

const save = (file: string, data: unknown) => {
  try {
    writeJsonSync(file, data);
  } catch {}
};

export function markLimited(a: Account, until: number) {
  limited[a] = until;
  save(LIMITS, { ...limits(), [a]: until });
}

export const isLimited = (a: Account, now = Date.now()) => limitedUntil(a) > now;

// Extra usage is never used: a rate limit event that reports it counts as hitting the limit, until the window resets.
export function overageUntil(m: { type: string; rate_limit_info?: { isUsingOverage?: boolean; overageInUse?: boolean; resetsAt?: number } }, now = Date.now()) {
  const r = m.type === 'rate_limit_event' ? m.rate_limit_info : undefined;
  if (!r?.isUsingOverage && !r?.overageInUse) return null;
  return r.resetsAt ? r.resetsAt * 1000 : now + 5 * 3600_000;
}

export function guardLimit(a: Account) {
  if (isLimited(a)) throw new Error('The Claude account is at its usage limit');
}

export function stopOnOverage(a: Account, m: Parameters<typeof overageUntil>[0]) {
  const until = overageUntil(m);
  if (!until) return;
  markLimited(a, until);
  throw new Error('Stopped before using extra usage');
}

// The account to switch to when this one hits its limit, if the other one has usage left.
export function otherAccount(a: Account, now = Date.now()): Account | null {
  const o: Account = a === 'main' ? 'alt' : 'main';
  return usable(o, now) ? o : null;
}

// New chats start on the main account unless it is out of usage.
export const freshAccount = (now = Date.now()): Account => (usable('main', now) ? 'main' : otherAccount('main', now) ?? 'main');

// Chats on the work account, so a reopened chat goes back to the account it was on.
const chatAccounts: Record<string, Account> = readJsonSync<Record<string, Account> | null>(CHATS, null) ?? {};

export function rememberAccount(sessionId: string, a: Account) {
  if ((chatAccounts[sessionId] ?? 'main') === a) return;
  if (a === 'main') delete chatAccounts[sessionId];
  else chatAccounts[sessionId] = a;
  save(CHATS, chatAccounts);
}

export const reopenAccount = (sessionId: string | undefined, now = Date.now()): Account => {
  const a = sessionId ? chatAccounts[sessionId] : undefined;
  return a && usable(a, now) ? a : freshAccount(now);
};
