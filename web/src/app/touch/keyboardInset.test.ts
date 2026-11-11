import { describe, expect, it } from 'bun:test';
import { KEYBOARD_MIN, keyboardInset } from './keyboardInset';

describe('keyboardInset', () => {
  it('is 0 with no keyboard', () => expect(keyboardInset(800, 800, 0)).toBe(0));
  it('returns the keyboard height', () => expect(keyboardInset(800, 500, 0)).toBe(300));
  it('subtracts offsetTop when the viewport is panned', () => expect(keyboardInset(800, 500, 120)).toBe(180));
  it('ignores changes under the minimum', () => {
    expect(keyboardInset(800, 800 - (KEYBOARD_MIN - 1), 0)).toBe(0);
    expect(keyboardInset(800, 800 - KEYBOARD_MIN, 0)).toBe(KEYBOARD_MIN);
  });
  it('is 0 when the viewport is taller than the layout', () => expect(keyboardInset(800, 900, 0)).toBe(0));
});
