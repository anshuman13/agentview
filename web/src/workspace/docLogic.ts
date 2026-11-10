import { shownFeature } from '../../../shared/featureUse';

export const shownRunItems = (hidden: string[]) => ({ all: shownFeature('action:runAll', hidden), goal: shownFeature('action:runAsGoal', hidden) });
