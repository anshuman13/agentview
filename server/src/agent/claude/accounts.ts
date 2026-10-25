import os from 'node:os';
import path from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Account } from '../../../../shared/protocol.js';

const ALT_DIR = process.env.AGENTVIEW_ALT_CLAUDE || path.join(os.homedir(), '.claude-alt');
const LIMITS = path.join(process.env.AGENTVIEW_LIMITS_DIR ?? path.join(os.homedir(), '.agentview'), 'limits.json');

const readJson = (file: string) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

// Until when each account is out of usage, kept across restarts.
const limited: Partial<Record<Account, number>> = readJson(LIMITS) ?? {};

// The second account counts once it is logged in.
export const hasAlt = () => Boolean(readJson(path.join(ALT_DIR, '.claude.json'))?.oauthAccount);

export const configDir = (a: Account) => (a === 'alt' ? ALT_DIR : undefined);

const usable = (a: Account, now: number) => (a === 'main' || hasAlt()) && (limited[a] ?? 0) <= now;

export function markLimited(a: Account, until: number) {
  limited[a] = until;
  try {
    mkdirSync(path.dirname(LIMITS), { recursive: true });
    writeFileSync(LIMITS, JSON.stringify(limited));
  } catch {}
}

// The account to switch to when this one hits its limit, if the other one has usage left.
export function otherAccount(a: Account, now = Date.now()): Account | null {
  const o: Account = a === 'main' ? 'alt' : 'main';
  return usable(o, now) ? o : null;
}

// New and reopened chats start on the main account unless it is out of usage.
export const freshAccount = (now = Date.now()): Account => (usable('main', now) ? 'main' : otherAccount('main', now) ?? 'main');
