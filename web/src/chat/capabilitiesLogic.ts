import { EFFORT_LEVELS, type Capabilities } from '../../../shared/protocol';
import { modelRow } from '../../../shared/providers';

// A chat without capabilities (an older host) supports everything.
export const can = (caps: Capabilities | undefined, what: keyof Capabilities) => caps?.[what] !== false;

// The effort levels the chat's model lists, or all of them when it lists none.
export const effortsFor = (models: { value: string; displayName: string; efforts?: string[] }[], model: string | null) => {
  const row = modelRow(models, model);
  const listed = models.find((m) => m.value === row)?.efforts;
  return listed ? EFFORT_LEVELS.filter((e) => listed.includes(e)) : [...EFFORT_LEVELS];
};
