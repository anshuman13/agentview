import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { stubGlobal, unstubAllGlobals } from '../../../../testing';

const react = createRequire(import.meta.url)('react') as typeof import('react');

vi.mock('react', () => ({ ...react, useEffect: (fn: () => void) => fn() }));

const { edgeBackEnabled, useEdgeBack } = await import('./edgeBack');

const ANDROID_14 = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
const ANDROID_10 = 'Mozilla/5.0 (Linux; Android 10; SM-G960F) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
const ANDROID_9 = 'Mozilla/5.0 (Linux; Android 9; SM-G960F) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36';

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
  afterEach(() => unstubAllGlobals());

  const run = (userAgent: string, tauri: boolean) => {
    const handlers: Record<string, (e: unknown) => void> = {};
    const back = vi.fn();
    stubGlobal('document', { addEventListener: (n: string, f: (e: unknown) => void) => (handlers[n] = f), removeEventListener: () => {} });
    stubGlobal('window', tauri ? { __TAURI__: {} } : {});
    stubGlobal('navigator', { userAgent });
    stubGlobal('innerWidth', 400);
    stubGlobal('getSelection', () => null);
    stubGlobal('history', { state: { av: 1 }, back });
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
