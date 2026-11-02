import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';

const dir = process.env.AGENTVIEW_LIMITS_DIR!;
const HOME = `${os.homedir()}/workspace_personal/app`;
const WORK = `${os.homedir()}/workspace/app`;

const { freshAccount, isLimited, loggedIn, loggedInAccounts, markLimited, otherAccount, overageUntil, rememberAccount, reopenAccount, verifyLimit } = await import('./accounts.js');

describe('accounts', () => {
  it('falls back to the second account only once it is logged in and has usage left', () => {
    expect(loggedIn('alt')).toBe(false);
    expect(otherAccount('main', 1000)).toBe(null);
    mkdirSync(`${dir}/alt`, { recursive: true });
    writeFileSync(`${dir}/alt/.claude.json`, JSON.stringify({ oauthAccount: { emailAddress: 'a@b.c' } }));
    expect(loggedIn('alt')).toBe(true);
    expect(otherAccount('main', 1000)).toBe('alt');
    expect(freshAccount(HOME, 1000)).toBe('main');
    markLimited('main', 5000);
    expect(freshAccount(HOME, 1000)).toBe('alt');
    expect(freshAccount(HOME, 6000)).toBe('main');
    markLimited('alt', 5000);
    expect(otherAccount('main', 1000)).toBe(null);
    expect(otherAccount('alt', 6000)).toBe('main');
    expect(isLimited('alt', 1000)).toBe(true);
    expect(isLimited('alt', 6000)).toBe(false);
  });

  it('never falls back to a hand-picked account', () => {
    mkdirSync(`${dir}/alt2`, { recursive: true });
    writeFileSync(`${dir}/alt2/.claude.json`, JSON.stringify({ oauthAccount: { emailAddress: 'a@b.c' } }));
    expect(loggedInAccounts()).toEqual(['main', 'alt', 'alt2']);
    expect(otherAccount('main', 1000)).toBe(null);
    expect(freshAccount(HOME, 1000)).toBe('main');
    expect(otherAccount('alt2', 6000)).toBe('main');
    expect(otherAccount('main', 6000)).toBe('alt');
    rmSync(`${dir}/alt2`, { recursive: true });
    expect(loggedInAccounts()).toEqual(['main', 'alt']);
  });

  it('starts a work folder on the work account', () => {
    expect(freshAccount(WORK, 6000)).toBe('alt');
    expect(freshAccount(HOME, 6000)).toBe('main');
  });

  it('reopens a chat on the account it was on while that one has usage left', () => {
    rememberAccount('s1', 'alt');
    expect(reopenAccount('s1', HOME, 6000)).toBe('alt');
    expect(reopenAccount('s2', HOME, 6000)).toBe('main');
    expect(reopenAccount('s1', HOME, 1000)).toBe('main');
    rememberAccount('s1', 'main');
    expect(reopenAccount('s1', HOME, 6000)).toBe('main');
  });

  it('counts extra usage as hitting the limit', () => {
    expect(overageUntil({ type: 'rate_limit_event', rate_limit_info: { isUsingOverage: false } })).toBe(null);
    expect(overageUntil({ type: 'assistant' })).toBe(null);
    expect(overageUntil({ type: 'rate_limit_event', rate_limit_info: { isUsingOverage: true, resetsAt: 1_900_000_000 } })).toBe(1_900_000_000_000);
    expect(overageUntil({ type: 'rate_limit_event', rate_limit_info: { overageInUse: true } }, 1000)).toBe(1000 + 5 * 3600_000);
  });

  it('keeps limits another process wrote', () => {
    writeFileSync(`${dir}/limits.json`, JSON.stringify({ alt: 9000 }));
    expect(otherAccount('main', 7000)).toBe(null);
    markLimited('main', 8000);
    expect(JSON.parse(readFileSync(`${dir}/limits.json`, 'utf8'))).toEqual({ main: 8000, alt: 9000 });
  });

  it('clears a limit mark only when live usage shows every window under 100%', async () => {
    const soon = Date.now() + 3600_000;
    const usage = (five: number, week: number) => ({ rate_limits: { five_hour: { utilization: five }, seven_day: { utilization: week } } });
    markLimited('main', soon);
    const fail = vi.fn(async () => Promise.reject(new Error('timed out')));
    expect(await verifyLimit('main', fail)).toBe(true);
    const free = vi.fn(async () => usage(10, 20));
    expect(await verifyLimit('main', free)).toBe(true);
    expect(free).not.toHaveBeenCalled();
    markLimited('alt', soon);
    expect(await verifyLimit('alt', async () => usage(100, 20))).toBe(true);
    vi.setSystemTime(Date.now() + 6 * 60_000);
    expect(await verifyLimit('alt', async () => ({ rate_limits: { ...usage(10, 20).rate_limits, seven_day_opus: { utilization: 100 } } }))).toBe(true);
    vi.setSystemTime(Date.now() + 6 * 60_000);
    expect(await verifyLimit('alt', free)).toBe(false);
    expect(isLimited('alt')).toBe(false);
    expect(JSON.parse(readFileSync(`${dir}/limits.json`, 'utf8')).alt).toBeUndefined();
    vi.useRealTimers();
  });
});
