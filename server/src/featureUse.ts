import os from 'node:os';
import path from 'node:path';
import { FEATURE_IDS, dayKey, type UseDays } from '../../shared/featureUse.js';
import { jsonFile } from './json.js';
import { loadSettings } from './settings.js';

export const FEATURE_USE_FILE = process.env.AGENTVIEW_FEATURE_USE ?? path.join(os.homedir(), '.agentview/feature-use.json');

const KEEP_DAYS = 90;

const store = jsonFile<{ days: UseDays }>(FEATURE_USE_FILE, { days: {} });

const daysAgo = (now: Date, n: number) => dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));

// The update re-checks the setting, so a count racing with turning the setting off never recreates the file.
export async function recordFeature(id: string, now = new Date()) {
  let recorded = false;
  await store.update((cur) => {
    if (!loadSettings().featureUse) return cur;
    recorded = true;
    const today = dayKey(now);
    const keep = daysAgo(now, KEEP_DAYS);
    const days = Object.fromEntries(Object.entries(cur.days).filter(([day]) => day >= keep));
    days[today] = { ...days[today], [id]: (days[today]?.[id] ?? 0) + 1 };
    return { days };
  });
  return recorded;
}

export async function featureUseDays(now = new Date()) {
  if (!loadSettings().featureUse) return {};
  const from = daysAgo(now, KEEP_DAYS);
  return Object.fromEntries(Object.entries((await store.read()).days).filter(([day]) => day >= from));
}

export const clearFeatureUse = () => store.clear();

export async function recordRoute(id: unknown) {
  if (!loadSettings().featureUse) return { recorded: false };
  if (typeof id !== 'string' || !FEATURE_IDS.has(id)) return { status: 400, body: { error: 'Unknown feature' } };
  return { recorded: await recordFeature(id) };
}
