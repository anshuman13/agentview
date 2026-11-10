import { describe, expect, it, vi } from 'vitest';
import { badgeArg, createBadgeSender } from './launcherBadge';

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
