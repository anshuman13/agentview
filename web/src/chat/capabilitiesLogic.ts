import { EFFORT_LABEL, EFFORT_LEVELS, type Capabilities } from '../../../shared/protocol';
import { modelRow } from '../../../shared/providers';

// A chat without capabilities (an older host) supports everything.
export const can = (caps: Capabilities | undefined, what: keyof Capabilities) => caps?.[what] !== false;

// The effort levels the chat's model lists, or all of them when it lists none.
export const effortsFor = (models: { value: string; displayName: string; efforts?: string[] }[], model: string | null) => {
  const row = modelRow(models, model);
  const listed = models.find((m) => m.value === row)?.efforts;
  return listed ? EFFORT_LEVELS.filter((e) => listed.includes(e)) : [...EFFORT_LEVELS];
};

// The effort picker rows; the model's own default is tagged Recommended.
export const effortChoices = (models: { value: string; displayName: string; efforts?: string[]; defaultEffort?: string }[], model: string | null) => {
  const row = modelRow(models, model);
  const recommended = models.find((m) => m.value === row)?.defaultEffort;
  return effortsFor(models, model).map((e) => ({ value: e, label: EFFORT_LABEL[e], ...(e === recommended && { detail: 'Recommended' }) }));
};
