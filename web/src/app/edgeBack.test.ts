import { describe, expect, it } from 'vitest';
import { edgeBackEnd } from './edgeBack';

const swipe = (x0: number, dx: number, dy = 0, ms = 200, depth = 1) => edgeBackEnd({ x: x0, y: 100 }, { x: x0 + dx, y: 100 + dy }, ms, depth);

describe('edgeBackEnd', () => {
  it('starts only within 20px of the edge', () => {
    expect(swipe(20, 100)).toBe(true);
    expect(swipe(21, 100)).toBe(false);
  });
  it('needs 70px of travel', () => {
    expect(swipe(10, 69)).toBe(false);
    expect(swipe(10, 70)).toBe(true);
  });
  it('needs a mostly horizontal swipe', () => {
    expect(swipe(10, 100, 50)).toBe(true);
    expect(swipe(10, 100, -51)).toBe(false);
  });
  it('needs under 600ms', () => {
    expect(swipe(10, 100, 0, 599)).toBe(true);
    expect(swipe(10, 100, 0, 600)).toBe(false);
  });
  it('ignores leftward swipes and no open layer', () => {
    expect(swipe(10, -100)).toBe(false);
    expect(swipe(10, 100, 0, 200, 0)).toBe(false);
  });
});
