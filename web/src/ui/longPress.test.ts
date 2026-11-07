import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLongPress, LONG_PRESS_MS, LONG_PRESS_SLOP } from './longPress';

describe('createLongPress', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires once at 500ms and not before', () => {
    const fire = vi.fn();
    const p = createLongPress(fire);
    p.start(0, 0);
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(p.end()).toBe(true);
  });

  it('end before the delay never fires', () => {
    const fire = vi.fn();
    const p = createLongPress(fire);
    p.start(0, 0);
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(p.end()).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(fire).not.toHaveBeenCalled();
  });

  it('keeps the timer at the slop and cancels beyond it', () => {
    const fire = vi.fn();
    const p = createLongPress(fire);
    p.start(0, 0);
    p.move(LONG_PRESS_SLOP, 0);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(fire).toHaveBeenCalledTimes(1);
    p.start(0, 0);
    p.move(LONG_PRESS_SLOP + 1, 0);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('cancel and a second start rearm cleanly', () => {
    const fire = vi.fn();
    const p = createLongPress(fire);
    p.start(0, 0);
    p.cancel();
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(fire).not.toHaveBeenCalled();
    p.start(0, 0);
    vi.advanceTimersByTime(300);
    p.start(0, 0);
    vi.advanceTimersByTime(300);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(fire).toHaveBeenCalledTimes(1);
  });
});
