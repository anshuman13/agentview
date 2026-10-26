import { describe, expect, it } from 'vitest';
import { parseWhen, stripWhen } from './engine';

const now = new Date(2026, 9, 26, 17, 3, 20);
const local = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
const read = (s: string) => {
  const w = parseWhen(s, now);
  return { at: w?.at, title: stripWhen(s, w) };
};

describe('parseWhen', () => {
  it('reads relative times', () => {
    expect(read('add a task to get burger buns set a reminder 1 hour from now')).toEqual({ at: local(26, 18, 4), title: 'get burger buns' });
    expect(read('call mum in an hour').at).toBe(local(26, 18, 4));
    expect(read('tea in 30 min').at).toBe(local(26, 17, 34));
    expect(read('tea in 15m')).toEqual({ at: local(26, 17, 19), title: 'tea' });
    expect(read('in half an hour stretch').at).toBe(local(26, 17, 34));
    expect(read('pay rent in 2 days').at).toBe(local(28, 17, 4));
  });

  it('reads dates and times', () => {
    expect(read('call the bank tomorrow 9')).toEqual({ at: local(27, 9), title: 'call the bank' });
    expect(read('demo fri at 14:30').at).toBe(local(30, 14, 30));
    expect(read('call at 10pm').at).toBe(local(26, 22));
    expect(read('standup 9').at).toBeUndefined();
    expect(read('call at 9').at).toBe(local(27, 9));
  });

  it('reads parts of the day', () => {
    expect(read('cook this evening')).toEqual({ at: local(26, 19), title: 'cook' });
    expect(read('run tomorrow morning')).toEqual({ at: local(27, 9), title: 'run' });
    expect(read('movie tonight at 8').at).toBe(local(26, 20));
    expect(read('gym this morning').at).toBe(local(27, 9));
  });

  it('keeps today without a time in Today', () => {
    expect(read('buy milk today')).toEqual({ at: null, title: 'buy milk' });
  });

  it('leaves amounts that are not times alone', () => {
    expect(read('buy 2 days of food').at).toBeUndefined();
    expect(read('buy 12 eggs').at).toBeUndefined();
  });
});
