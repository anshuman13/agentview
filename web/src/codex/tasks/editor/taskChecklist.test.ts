import { expect, it } from 'vitest';
import { addCheck, checkItems, moveCheck, noteView, toggleCheck } from './taskChecklist';

it('flips only the nth checklist line', () => {
  const text = 'Plan\n- [ ] a\n* [x] b\n  - [ ] c [x]';
  expect(toggleCheck(text, 1)).toBe('Plan\n- [ ] a\n* [ ] b\n  - [ ] c [x]');
  expect(toggleCheck(text, 2)).toBe('Plan\n- [ ] a\n* [x] b\n  - [x] c [x]');
  expect(checkItems(text).map((c) => c.done)).toEqual([false, true, false]);
});

it('moves a checklist line among the checklist slots', () => {
  const text = 'Plan\n- [ ] a\nnote\n* [x] b\n- [ ] c';
  expect(moveCheck(text, 0, 2)).toBe('Plan\n* [x] b\nnote\n- [ ] c\n- [ ] a');
  expect(moveCheck(text, 2, 0)).toBe('Plan\n- [ ] c\nnote\n- [ ] a\n* [x] b');
  expect(moveCheck(text, 1, 1)).toBe(text);
  expect(moveCheck(text, 0, 3)).toBe(text);
  expect(moveCheck(text, -1, 1)).toBe(text);
  expect(moveCheck('Plan\n- [ ] a', 0, 1)).toBe('Plan\n- [ ] a');
});

it('adds a subtask after the last checklist line', () => {
  expect(addCheck('', 'x')).toBe('- [ ] x');
  expect(addCheck('Plan', ' x ')).toBe('Plan\n- [ ] x');
  expect(addCheck('Plan\n', 'x')).toBe('Plan\n- [ ] x');
  expect(addCheck('- [ ] a\n- [x] b\nnote', 'x')).toBe('- [ ] a\n- [x] b\n- [ ] x\nnote');
  expect(addCheck('Plan', '  ')).toBe('Plan');
});

it('leaves the checklist and repeat lines out of the read view', () => {
  expect(noteView('Repeats: every monday 09:00\n# Plan\n- [ ] a\ntext\n* [x] b\n\nend')).toBe('# Plan\ntext\n\nend');
  expect(noteView('Repeats: every day 09:00\n- [ ] a\n- [x] b')).toBe('');
});
