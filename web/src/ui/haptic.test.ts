import { afterEach, describe, expect, it, vi } from 'vitest';
import { haptic } from './haptic';

const flush = () => new Promise((r) => setTimeout(r, 0));
const env = (invoke?: unknown, vibrate?: unknown) => {
  vi.stubGlobal('window', invoke ? { __TAURI__: { core: { invoke } } } : {});
  vi.stubGlobal('navigator', vibrate ? { vibrate } : {});
};

afterEach(() => vi.unstubAllGlobals());

describe('haptic', () => {
  it('is a no-op without vibrate or Tauri', () => {
    env();
    expect(() => { haptic('tap'); haptic('success'); }).not.toThrow();
  });

  it('vibrates 8 for tap and 15 for success on the web', () => {
    const vibrate = vi.fn();
    env(undefined, vibrate);
    haptic('tap');
    haptic('success');
    expect(vibrate.mock.calls).toEqual([[8], [15]]);
  });

  it('calls the plugin and skips vibrate when it resolves', async () => {
    const vibrate = vi.fn();
    const invoke = vi.fn(() => Promise.resolve());
    env(invoke, vibrate);
    haptic('tap');
    haptic('success');
    await flush();
    expect(invoke.mock.calls).toEqual([
      ['plugin:haptics|impact_feedback', { style: 'light' }],
      ['plugin:haptics|notification_feedback', { type: 'success' }],
    ]);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('falls back to vibrate when the plugin rejects or throws', async () => {
    const vibrate = vi.fn();
    env(vi.fn(() => Promise.reject(new Error('no plugin'))), vibrate);
    haptic('tap');
    await flush();
    expect(vibrate).toHaveBeenCalledWith(8);
    env(() => { throw new Error('sync'); }, vibrate);
    haptic('success');
    expect(vibrate).toHaveBeenCalledWith(15);
  });
});
