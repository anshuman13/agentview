import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const dir = vi.hoisted(() => {
  const d = `${process.env.TMPDIR ?? '/tmp'}/agentview-accounts-${process.pid}`;
  process.env.AGENTVIEW_ALT_CLAUDE = `${d}/alt`;
  process.env.AGENTVIEW_LIMITS_DIR = d;
  return d;
});

const { freshAccount, hasAlt, isLimited, markLimited, otherAccount, overageUntil } = await import('./accounts.js');

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

  it('counts extra usage as hitting the limit', () => {
    expect(overageUntil({ type: 'rate_limit_event', rate_limit_info: { isUsingOverage: false } })).toBe(null);
    expect(overageUntil({ type: 'assistant' })).toBe(null);
    expect(overageUntil({ type: 'rate_limit_event', rate_limit_info: { isUsingOverage: true, resetsAt: 1_900_000_000 } })).toBe(1_900_000_000_000);
    expect(overageUntil({ type: 'rate_limit_event', rate_limit_info: { overageInUse: true } }, 1000)).toBe(1000 + 5 * 3600_000);
  });
});
