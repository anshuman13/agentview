import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AutopilotState } from '../data/store';
import { activityValue, awayValue, coversValue, modelValue, neverValue } from './autopilotRows';
import { SettingRows } from './AutopilotPage';

vi.mock('../data', () => ({ useAssistantStore: () => ({}), useAssistantTable: () => [] }));

const state = (config: Partial<AutopilotState['config']> = {}, rest: Partial<AutopilotState> = {}) => ({
  config: { enabled: true, dry_run: true, away: { from: '', to: '', backup: '', note: '' }, escalate: [], manager: '', dms: true, min_confidence: 0.7, model: 'sonnet', ...config },
  mode: 'assist', watched: ['a', 'b', 'c', 'd', 'e'], covered: ['a', 'b', 'c'], push: { from: 0, to: 0 }, texts: null, scan: null, cost: null, replies: [], ...rest,
}) as AutopilotState;

describe('autopilot row values', () => {
  it('away is Off or the dates', () => {
    expect(awayValue(state())).toBe('Off');
    expect(awayValue(state({ away: { from: '2026-11-12', to: '2026-11-14', backup: '', note: '' } }))).toMatch(/ to /);
  });
  it('covers counts channels, with DMs only when on', () => {
    expect(coversValue(state())).toBe('DMs and 3 of 5 channels');
    expect(coversValue(state({ dms: false }))).toBe('3 of 5 channels');
  });
  it('never counts the manager with the list', () => {
    expect(neverValue(state())).toBe('Nobody');
    expect(neverValue(state({ manager: 'Kim' }))).toBe('Kim');
    expect(neverValue(state({ escalate: ['Lee'] }))).toBe('Lee');
    expect(neverValue(state({ manager: 'Kim', escalate: ['Lee', 'Sam'] }))).toBe('3 people');
  });
  it('model names Sonnet or Opus', () => {
    expect(modelValue(state())).toBe('Sonnet');
    expect(modelValue(state({ model: 'opus' }))).toBe('Opus');
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

describe('settings rows', () => {
  it('list the five settings in order, none with more than 40 characters of text', () => {
    const h = renderToStaticMarkup(<SettingRows state={state()} onOpen={() => {}} onDryRun={() => {}} />);
    const titles = [...h.matchAll(/ui-row-title[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(titles).toEqual(['Away', 'Covers', 'Never answers', 'Model', 'Dry run', 'Activity']);
    for (const t of h.matchAll(/>([^<>]+)</g)) expect(t[1].length).toBeLessThanOrEqual(40);
  });
});
