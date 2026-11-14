import type { GoalForm } from './goalForm.js';

export type GoalPreset = GoalForm & { name: string };

const MAX_PRESETS = 6;
const MAX_NAME = 24;

const nullable = (v: unknown, type: string) => v === null || typeof v === type;

function isPreset(v: any): v is GoalPreset {
  return Boolean(v) && typeof v.name === 'string' && v.name.trim() !== '' && typeof v.what === 'string' && typeof v.every === 'number'
    && nullable(v.stopIn, 'number') && nullable(v.stopAt, 'string') && nullable(v.capPct, 'number') && nullable(v.builds, 'number');
}

export function parsePresets(raw: string | null): GoalPreset[] {
  try {
    const list = JSON.parse(raw ?? '');
    return Array.isArray(list) ? list.filter(isPreset) : [];
  } catch {
    return [];
  }
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function addPreset(list: GoalPreset[], p: GoalPreset): GoalPreset[] {
  const name = p.name.trim().slice(0, MAX_NAME);
  return [{ ...p, name }, ...list.filter((x) => !sameName(x.name, name))].slice(0, MAX_PRESETS);
}

export const removePreset = (list: GoalPreset[], name: string) => list.filter((x) => !sameName(x.name, name));
