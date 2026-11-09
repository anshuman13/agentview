import os from 'node:os';
import path from 'node:path';
import { statSync } from 'node:fs';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { ACCOUNT_NOTE, type Account } from '../../../../shared/protocol.js';
import { readJsonSync, writeJsonSync } from '../../json.js';

const DIRS: Partial<Record<Account, string>> = {
  alt: process.env.AGENTVIEW_ALT_CLAUDE || path.join(os.homedir(), '.claude-alt'),
  alt2: process.env.AGENTVIEW_ALT2_CLAUDE || path.join(os.homedir(), '.claude-alt2'),
};
const ORDER: Account[] = ['main', 'alt', 'alt2'];
const AUTO = ORDER.filter((a) => !ACCOUNT_NOTE[a]);
const LIMITS = path.join(process.env.AGENTVIEW_LIMITS_DIR ?? path.join(os.homedir(), '.agentview'), 'limits.json');
const CHATS = path.join(path.dirname(LIMITS), 'chat-accounts.json');

type Limits = Partial<Record<Account, number>>;

// Until when each account is out of usage, kept across restarts. The hub marks limits in the same file, so it is read each time.
const limited: Limits = {};
const limits = (): Limits => readJsonSync<Limits | null>(LIMITS, null) ?? {};
export const limitedUntil = (a: Account) => Math.max(limits()[a] ?? 0, limited[a] ?? 0);

// An extra account counts once it is logged in. The file is large, so it is read again only when it changes.
const seen = new Map<Account, { mtime: number; value: boolean }>();
export function loggedIn(a: Account) {
  const dir = DIRS[a];
  if (!dir) return true;
  const file = path.join(dir, '.claude.json');
  let mtime = 0;
  try {
    mtime = statSync(file).mtimeMs;
  } catch {}
  if (mtime !== seen.get(a)?.mtime) seen.set(a, { mtime, value: Boolean(mtime && readJsonSync<{ oauthAccount?: unknown } | null>(file, null)?.oauthAccount) });
  return seen.get(a)!.value;
}

export const loggedInAccounts = () => ORDER.filter(loggedIn);

export const configDir = (a: Account) => DIRS[a];

const usable = (a: Account, now: number) => loggedIn(a) && limitedUntil(a) <= now;

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

function clearLimit(a: Account) {
  delete limited[a];
  const { [a]: _, ...rest } = limits();
  save(LIMITS, rest);
}

type Window = { utilization: number | null } | null | undefined;
type Windows = { five_hour?: Window; seven_day?: Window; seven_day_opus?: Window; seven_day_sonnet?: Window; seven_day_oauth_apps?: Window; model_scoped?: Window[] };
type LiveUsage = { rate_limits?: Windows | null };

const under = (w: Window) => w?.utilization != null && w.utilization < 100;

// A mark can come from a per-model weekly limit, so any full window keeps it.
const free = (r: Windows | null | undefined) =>
  !!r && under(r.five_hour) && under(r.seven_day) && ![r.seven_day_opus, r.seven_day_sonnet, r.seven_day_oauth_apps, ...(r.model_scoped ?? [])].some((w) => (w?.utilization ?? 0) >= 100);

// The account's live usage, read from a CLI that gets no prompt, so the check itself uses none.
async function liveUsage(a: Account): Promise<LiveUsage> {
  const dir = configDir(a);
  let stop = () => {};
  const stopped = new Promise<void>((r) => (stop = r));
  async function* noPrompt() {
    await stopped;
  }
  const q = query({ prompt: noPrompt(), options: { persistSession: false, settingSources: [], env: { ...process.env, ...(dir && { CLAUDE_CONFIG_DIR: dir }) } } });
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error('Usage check timed out')), 20_000)));
    return await Promise.race([q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }), timeout]);
  } finally {
    clearTimeout(timer);
    stop();
    q.close();
  }
}

const checked = new Map<Account, number>();
const checking = new Map<Account, Promise<boolean>>();

// A limit mark can be wrong, so live usage confirms it at most every 5 minutes; a mark with every window under 100% is cleared. A failed check keeps the mark.
export function verifyLimit(a: Account, check = liveUsage): Promise<boolean> {
  if (!isLimited(a)) return Promise.resolve(false);
  const now = Date.now();
  if (now - (checked.get(a) ?? -Infinity) < 5 * 60_000) return checking.get(a) ?? Promise.resolve(isLimited(a));
  checked.set(a, now);
  const until = limitedUntil(a);
  const run = check(a)
    .then((u) => {
      if (free(u.rate_limits) && limitedUntil(a) === until) clearLimit(a);
    })
    .catch(() => {})
    .then(() => isLimited(a))
    .finally(() => checking.delete(a));
  checking.set(a, run);
  return run;
}

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

// The account to switch to when this one hits its limit: the next one after it with usage left, skipping hand-picked ones.
export function otherAccount(a: Account, now = Date.now()): Account | null {
  const i = AUTO.indexOf(a);
  return [...AUTO.slice(i + 1), ...AUTO.slice(0, i)].find((o) => o !== a && usable(o, now)) ?? null;
}

const PERSONAL = path.join(os.homedir(), 'workspace_personal');
export const profileOf = (cwd: string) => (cwd === PERSONAL || cwd.startsWith(PERSONAL + path.sep) ? 'personal' : 'work');

// New chats start on the folder's account, personal or work, unless it is out of usage.
export const freshAccount = (cwd: string, now = Date.now()): Account => {
  const a: Account = profileOf(cwd) === 'personal' || !loggedIn('alt') ? 'main' : 'alt';
  return usable(a, now) ? a : otherAccount(a, now) ?? a;
};

// The account each chat was last on, so a reopened chat goes back to it.
const chatAccounts: Record<string, Account> = readJsonSync<Record<string, Account> | null>(CHATS, null) ?? {};

export function rememberAccount(sessionId: string, a: Account) {
  if (chatAccounts[sessionId] === a) return;
  chatAccounts[sessionId] = a;
  save(CHATS, chatAccounts);
}

export const reopenAccount = (sessionId: string | undefined, cwd: string, now = Date.now()): Account => {
  const a = sessionId ? chatAccounts[sessionId] : undefined;
  return a && usable(a, now) ? a : freshAccount(cwd, now);
};
