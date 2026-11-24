import { expect, it } from 'bun:test';
import { sameEvent, uniqueEvents } from './sameEvent';

const ev = (id: string, title: string, s = 1, e = 2) => ({ id, title, starts_at: s, ends_at: e });

it('treats the same id or the same time with a reworded title as one event', () => {
  expect(sameEvent(ev('a', 'Standup'), ev('a', 'Standup', 5, 6))).toBe(true);
  expect(sameEvent(ev('a', 'Flight to Stockholm Arlanda from Gardermoen (D84102)'), ev('b', 'Flight to Stockholm (D8 4102)'))).toBe(true);
  expect(sameEvent(ev('a', '1:1 Anna'), ev('b', '1:1 Per'))).toBe(false);
  expect(sameEvent(ev('a', 'Flight to Stockholm'), ev('b', 'Flight to Stockholm', 1, 3))).toBe(false);
  expect(uniqueEvents([ev('a', 'X y z'), ev('b', 'Other'), ev('c', 'x y z')]).map((r) => r.id)).toEqual(['a', 'b']);
});
