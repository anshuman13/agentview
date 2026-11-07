import { beforeEach, expect, test } from 'vitest';
import { clearScroll, saveScroll, takeScroll } from './scrollStore';

beforeEach(() => {
  clearScroll('tasks');
  clearScroll('meetings');
});

test('take returns the saved value once', () => {
  saveScroll('tasks:work', 120);
  expect(takeScroll('tasks:work')).toBe(120);
  expect(takeScroll('tasks:work')).toBeNull();
});

test('filters are independent', () => {
  saveScroll('tasks:work', 1);
  saveScroll('tasks:all', 2);
  expect(takeScroll('tasks:all')).toBe(2);
  expect(takeScroll('tasks:work')).toBe(1);
});

test('clear removes every filter of one list only', () => {
  saveScroll('tasks:work', 1);
  saveScroll('tasks:all', 2);
  saveScroll('meetings:work', 3);
  clearScroll('tasks');
  expect(takeScroll('tasks:work')).toBeNull();
  expect(takeScroll('tasks:all')).toBeNull();
  expect(takeScroll('meetings:work')).toBe(3);
});

test('take on a missing key is null', () => {
  expect(takeScroll('tasks:none')).toBeNull();
});
