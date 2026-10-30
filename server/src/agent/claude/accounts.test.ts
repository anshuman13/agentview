import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const dir = process.env.AGENTVIEW_LIMITS_DIR!;

const { freshAccount, hasAlt, isLimited, markLimited, otherAccount, overageUntil, rememberAccount, reopenAccount, verifyLimit } = await import('./accounts.js');

describe('accounts', () => {
  it('falls back to the second account only once it is logged in and has usage left', () => {
    expect(hasAlt()).toBe(false);
    expect(otherAccount('main', 1000)).toBe(null);
    mkdirSync(`${dir}/alt`, { recursive: true });
    writeFileSync(`${dir}/alt/.claude.json`, JSON.stringify({ oauthAccount: { emailAddress: 'a@b.c' } }));
    expect(hasAlt()).toBe(true);
    expect(otherAccount('main', 1000)).toBe('alt');
    expect(freshAccount(1000)).toBe('main');
    markLimited('main', 5000);
    expect(freshAccount(1000)).toBe('alt');
    expect(freshAccount(6000)).toBe('main');
    markLimited('alt', 5000);
    expect(otherAccount('main', 1000)).toBe(null);
    expect(otherAccount('alt', 6000)).toBe('main');
    expect(isLimited('alt', 1000)).toBe(true);
    expect(isLimited('alt', 6000)).toBe(false);
  });

  it('reopens a chat on the account it was on while that one has usage left', () => {
    rememberAccount('s1', 'alt');
    expect(reopenAccount('s1', 6000)).toBe('alt');
    expect(reopenAccount('s2', 6000)).toBe('main');
    expect(reopenAccount('s1', 1000)).toBe('main');
    rememberAccount('s1', 'main');
    expect(reopenAccount('s1', 6000)).toBe('main');
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

  it('clears a limit mark only when live usage shows both windows under 100%', async () => {
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
    expect(await verifyLimit('alt', free)).toBe(false);
    expect(isLimited('alt')).toBe(false);
    expect(JSON.parse(readFileSync(`${dir}/limits.json`, 'utf8')).alt).toBeUndefined();
    vi.useRealTimers();
  });
});
