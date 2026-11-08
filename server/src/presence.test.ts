import { describe, expect, it } from 'vitest';
import { createPresence, desktopActive, isPhone } from './presence.js';

describe('presence', () => {
  it('records the time of the last desktop touch', () => {
    let t = 1_000_000;
    const p = createPresence(() => t);
    expect(p.at()).toBe(0);
    p.touch();
    expect(p.at()).toBe(t);
    t += 5_000;
    p.touch();
    expect(p.at()).toBe(t);
  });

  it('reads a reported time', () => {
    expect(desktopActive(0, 5)).toBe(false);
    expect(desktopActive(1000, 1000 + 60_000)).toBe(true);
    expect(desktopActive(1000, 1000 + 180_000)).toBe(false);
  });

  it('tells phones from desktops', () => {
    expect(isPhone('phone', undefined)).toBe(true);
    expect(isPhone(null, 'Mozilla/5.0 (Linux; Android 14)')).toBe(true);
    expect(isPhone(null, 'Mozilla/5.0 (Macintosh; Intel Mac OS X)')).toBe(false);
    expect(isPhone(null, undefined)).toBe(false);
  });
});
