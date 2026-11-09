import { describe, expect, it } from 'vitest';
import type { AutopilotState } from '../data/store';
import { activityValue, neverValue } from './autopilotRows';

const state = (config: Partial<AutopilotState['config']> = {}, rest: Partial<AutopilotState> = {}) => ({
  config: { enabled: true, dry_run: true, away: { from: '', to: '', backup: '', note: '' }, escalate: [], manager: '', dms: true, min_confidence: 0.7, model: 'sonnet', ...config },
  mode: 'assist', watched: ['a', 'b', 'c', 'd', 'e'], covered: ['a', 'b', 'c'], push: { from: 0, to: 0 }, texts: null, scan: null, cost: null, replies: [], ...rest,
}) as AutopilotState;

describe('autopilot row values', () => {
  it('never counts the manager with the list', () => {
    expect(neverValue(state())).toBe('Nobody');
    expect(neverValue(state({ manager: 'Kim' }))).toBe('Kim');
    expect(neverValue(state({ escalate: ['Lee'] }))).toBe('Lee');
    expect(neverValue(state({ manager: 'Kim', escalate: ['Lee', 'Sam'] }))).toBe('3 people');
  });
  it('activity joins the scan and the spend, each dropping out when absent', () => {
    const spend = { today: { usd: 0.2, models: [] }, week: { usd: 1.2, models: [] } };
    const now = Date.now();
    expect(activityValue(state())).toBe('No scan yet');
    expect(activityValue(state({}, { spend }))).toBe('$1.20 in 7 days');
    expect(activityValue(state({}, { scan: { scan: 'slack', ok: now } }))).toMatch(/^Scan \d/);
    expect(activityValue(state({}, { scan: { scan: 'slack', ok: now - 1000, failed: now, error: 'x' }, spend }))).toMatch(/^Scan failed .* · \$1\.20 in 7 days$/);
  });
});
