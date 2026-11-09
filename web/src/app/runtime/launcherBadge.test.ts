import { describe, expect, it, vi } from 'vitest';
import { badgeArg, badgeCount, createBadgeSender } from './launcherBadge';

describe('badgeCount', () => {
  it('counts rows, collapsed rows once each', () => {
    expect(badgeCount([])).toBe(0);
    expect(badgeCount([{ kind: 'dm' }])).toBe(1);
    expect(badgeCount([{ kind: 'overdueAll', rows: [1, 2, 3, 4] }, { kind: 'staleAsks', count: 5 }, { kind: 'wiki', count: 7 }, { kind: 'dm' }])).toBe(4);
  });
});

describe('badgeArg', () => {
  it('clamps to 0..99 and floors', () => {
    expect([0, 5, 99, 150, -1, NaN, 2.7].map(badgeArg)).toEqual([0, 5, 99, 99, 0, 0, 2]);
  });
});

describe('createBadgeSender', () => {
  it('skips equal repeats unless forced', () => {
    const invoke = vi.fn(() => Promise.resolve());
    const send = createBadgeSender(invoke);
    send(3);
    send(3);
    expect(invoke).toHaveBeenCalledTimes(1);
    send(4);
    send(0);
    expect(invoke).toHaveBeenLastCalledWith('plugin:badge|set_count', { count: 0 });
    send(0, true);
    expect(invoke).toHaveBeenCalledTimes(4);
  });

});
