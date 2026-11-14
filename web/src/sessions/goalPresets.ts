import { parsePresets, type GoalPreset } from '../../../shared/goalPresets';
import { save } from '../ui/util';

const KEY = 'goalPresets';

export const loadPresets = () => {
  try { return parsePresets(localStorage.getItem(KEY)); } catch { return []; }
};

export const savePresets = (list: GoalPreset[]) => save(KEY, list);
