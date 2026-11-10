import { describe, expect, it } from 'vitest';
import { shownRunItems } from './docLogic';

describe('hidden features', () => {
  it('the Run menu drops hidden items', () => {
    expect(shownRunItems([])).toEqual({ all: true, goal: true });
    expect(shownRunItems(['action:runAll'])).toEqual({ all: false, goal: true });
    expect(shownRunItems(['action:runAll', 'action:runAsGoal'])).toEqual({ all: false, goal: false });
  });
});
