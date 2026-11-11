import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { createRequire } from 'node:module';

const react = createRequire(import.meta.url)('react') as typeof import('react');

vi.mock('react', () => ({ ...react, useSyncExternalStore: (_sub: unknown, get: () => unknown) => get() }));

const { hideSnack, showSnack, useSnack } = await import('../view');

describe('snack store', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    hideSnack();
    vi.useRealTimers();
  });

  it('exposes text and undo, hides at 5000 ms and never runs undo itself', () => {
    const undo = vi.fn();
    showSnack('Done', undo);
    expect(useSnack()).toMatchObject({ text: 'Done', undo });
    vi.advanceTimersByTime(4999);
    expect(useSnack()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(useSnack()).toBeNull();
    expect(undo).not.toHaveBeenCalled();
  });

  it('a second snack replaces the first and restarts the timer', () => {
    showSnack('one', vi.fn());
    vi.advanceTimersByTime(3000);
    showSnack('two', vi.fn());
    vi.advanceTimersByTime(3000);
    expect(useSnack()?.text).toBe('two');
    vi.advanceTimersByTime(2000);
    expect(useSnack()).toBeNull();
  });

});
