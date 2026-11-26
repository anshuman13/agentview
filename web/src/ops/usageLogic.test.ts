import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'bun:test';
import type { UsageReport } from '../../../shared/protocol';
import { dayBars, limitRows, resetText, seriesLines, tokens, tokenTotals } from './usageLogic';

const fixture = JSON.parse(readFileSync(new URL('../../../shared/fixtures/usage.json', import.meta.url), 'utf8')) as {
  now: number; report: UsageReport; expected: { account: string; limits: unknown; lines: unknown; bars: unknown; totals: Record<string, string> }[];
};

describe('usage logic', () => {
  it('turns the shared fixture into the expected card values', () => {
    const { now, report, expected } = fixture;
    expect(report.accounts.map((a) => a.account)).toEqual(expected.map((e) => e.account) as never);
    report.accounts.forEach((a, i) => {
      const e = expected[i];
      expect(limitRows(a.latest, now)).toEqual(e.limits as never);
      expect(seriesLines(a.series, now)).toEqual(e.lines as never);
      expect(dayBars(a.days)).toEqual(e.bars as never);
      expect(Object.fromEntries(Object.entries(tokenTotals(a.days)).map(([k, v]) => [k, tokens(v)]))).toEqual(e.totals);
    });
  });

  it('writes reset times and token counts', () => {
    expect(resetText(null, 0)).toBe('');
    expect(resetText(45 * 60_000, 0)).toBe('resets in 45m');
    expect(resetText(-1, 0)).toBe('resets in 0m');
    expect(tokens(999)).toBe('999');
    expect(tokens(1_250_000_000)).toBe('1.3B');
  });

  it('shows extra usage that is turned off and a card with no sample', () => {
    expect(limitRows({ at: 0, models: [], extra: { enabled: false, limit: null, used: null, pct: null, currency: null } }, 0)).toEqual([{ label: 'Extra usage', pct: 0, text: 'off' }]);
    expect(limitRows(null, 0)).toEqual([]);
    expect(dayBars([])).toEqual([]);
  });
});
