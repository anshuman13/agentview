import { expect, it } from 'vitest';
import { checkItems, toggleCheck } from './taskChecklist';

it('flips only the nth checklist line', () => {
  const text = 'Plan\n- [ ] a\n* [x] b\n  - [ ] c [x]';
  expect(toggleCheck(text, 1)).toBe('Plan\n- [ ] a\n* [ ] b\n  - [ ] c [x]');
  expect(toggleCheck(text, 2)).toBe('Plan\n- [ ] a\n* [x] b\n  - [x] c [x]');
  expect(checkItems(text).map((c) => c.done)).toEqual([false, true, false]);
});
