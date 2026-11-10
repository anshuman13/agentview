import { existsSync, readFileSync, rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FEATURE_USE_FILE, clearFeatureUse, featureUseDays, recordFeature, recordRoute } from './featureUse.js';
import { loadSettings, saveSettings } from './settings.js';

const setting = (featureUse: boolean) => saveSettings({ ...loadSettings(), featureUse });
const days = () => JSON.parse(readFileSync(FEATURE_USE_FILE, 'utf8')).days as Record<string, Record<string, number>>;

describe('feature use', () => {
  beforeEach(() => rmSync(FEATURE_USE_FILE, { force: true }));
  afterEach(() => setting(false));

  it('records nothing and creates no file while off', async () => {
    await setting(false);
    expect(await recordRoute('page:builds')).toEqual({ recorded: false });
    expect(await recordRoute('nope')).toEqual({ recorded: false });
    expect(existsSync(FEATURE_USE_FILE)).toBe(false);
    expect(await featureUseDays()).toEqual({});
  });

  it('adds one per post, refuses unknown ids', async () => {
    await setting(true);
    await recordRoute('page:builds');
    expect(await recordRoute('page:builds')).toEqual({ recorded: true });
    expect(await recordRoute('page:nope')).toMatchObject({ status: 400 });
    expect(await recordRoute(undefined)).toMatchObject({ status: 400 });
    expect(Object.values(days())).toEqual([{ 'page:builds': 2 }]);
  });

  it('drops days older than 90 on the next write', async () => {
    await setting(true);
    const now = new Date(2026, 10, 10, 12);
    await recordFeature('page:mcp', new Date(2026, 10, 10 - 91, 12));
    await recordFeature('page:mcp', new Date(2026, 10, 10 - 90, 12));
    await recordFeature('page:builds', now);
    expect(Object.keys(days())).toEqual(['2026-08-12', '2026-11-10']);
    expect(Object.keys(await featureUseDays(now))).toEqual(['2026-11-10']);
  });

  it('the write re-checks the setting, and turning off deletes the file', async () => {
    await setting(true);
    await recordFeature('page:builds');
    expect(existsSync(FEATURE_USE_FILE)).toBe(true);
    await setting(false);
    expect(await recordFeature('page:builds')).toBe(false);
    expect(Object.values(days())).toEqual([{ 'page:builds': 1 }]);
    await clearFeatureUse();
    expect(existsSync(FEATURE_USE_FILE)).toBe(false);
  });
});
