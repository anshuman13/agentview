import { describe, expect, it } from 'vitest';
import { ROW_WINDOW } from '../../../../shared/protocol';
import { FIRST_ROWS, hiddenCount, needsEarlier, revealMore, stageRows, windowStart } from './window';

describe('staged rows', () => {
  it('steps by a batch and stops at the target', () => {
    expect(stageRows(30, 150)).toBe(60);
    expect(stageRows(120, 150)).toBe(150);
    expect(stageRows(30, 20)).toBe(20);
    expect(stageRows(10, 100, 5)).toBe(15);
  });

  it('reaches the window in four steps from the first rows', () => {
    let n = FIRST_ROWS, steps = 0;
    while (n < ROW_WINDOW) { n = stageRows(n, ROW_WINDOW); steps++; }
    expect(steps).toBe(4);
    expect(stageRows(n, ROW_WINDOW)).toBe(ROW_WINDOW);
  });
});

describe('row window', () => {
  it('reveals another batch and stops at the total', () => {
    expect(revealMore(150, 3000)).toBe(300);
    expect(revealMore(2900, 3000)).toBe(3000);
    expect(windowStart(3000, 3000)).toBe(0);
  });
});

describe('hidden count', () => {
  it('adds the events left out of the init to the rows the window hides', () => {
    expect(hiddenCount(250, 150, 150)).toBe(250);
    expect(hiddenCount(250, 200, 150)).toBe(300);
    expect(hiddenCount(0, 100, 150)).toBe(0);
  });
});

describe('needsEarlier', () => {
  it('loads while replies are few, history is left and under three automatic pages', () => {
    expect(needsEarlier(0, 600, 0)).toBe(true);
    expect(needsEarlier(2, 600, 2)).toBe(true);
    expect(needsEarlier(3, 600, 0)).toBe(false);
    expect(needsEarlier(0, 0, 0)).toBe(false);
    expect(needsEarlier(0, 600, 3)).toBe(false);
  });
});
