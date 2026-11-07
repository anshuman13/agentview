import { afterEach, describe, expect, it, vi } from 'vitest';
import { edgeBackEnabled, edgeBackEnd, useEdgeBack } from './edgeBack';

vi.mock('react', () => ({ useEffect: (fn: () => void) => fn() }));

const ANDROID_14 = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
const ANDROID_10 = 'Mozilla/5.0 (Linux; Android 10; SM-G960F) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
const ANDROID_9 = 'Mozilla/5.0 (Linux; Android 9; SM-G960F) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36';

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

describe('edgeBackEnabled', () => {
  it('is off only in Tauri on Android 10 or later', () => {
    expect(edgeBackEnabled(ANDROID_14, true)).toBe(false);
    expect(edgeBackEnabled(ANDROID_10, true)).toBe(false);
    expect(edgeBackEnabled(ANDROID_9, true)).toBe(true);
  });
  it('stays on everywhere else', () => {
    expect(edgeBackEnabled(ANDROID_14, false)).toBe(true);
    expect(edgeBackEnabled(IPHONE, true)).toBe(true);
    expect(edgeBackEnabled(DESKTOP, true)).toBe(true);
    expect(edgeBackEnabled('', true)).toBe(true);
    expect(edgeBackEnabled(undefined, true)).toBe(true);
  });
});

describe('useEdgeBack', () => {
  afterEach(() => vi.unstubAllGlobals());

  const run = (userAgent: string, tauri: boolean) => {
    const handlers: Record<string, (e: unknown) => void> = {};
    const back = vi.fn();
    vi.stubGlobal('document', { addEventListener: (n: string, f: (e: unknown) => void) => (handlers[n] = f), removeEventListener: () => {} });
    vi.stubGlobal('window', tauri ? { __TAURI__: {} } : {});
    vi.stubGlobal('navigator', { userAgent });
    vi.stubGlobal('innerWidth', 400);
    vi.stubGlobal('getSelection', () => null);
    vi.stubGlobal('history', { state: { av: 1 }, back });
    useEdgeBack();
    const target = { closest: () => null };
    handlers.touchstart({ touches: [{ clientX: 5, clientY: 100 }], target });
    handlers.touchend({ changedTouches: [{ clientX: 120, clientY: 100 }] });
    return back;
  };

  it('does not go back under Android gesture navigation', () => {
    expect(run(ANDROID_14, true)).not.toHaveBeenCalled();
  });
  it('goes back in mobile Chrome on Android', () => {
    expect(run(ANDROID_14, false)).toHaveBeenCalled();
  });
});
