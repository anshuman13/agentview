import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const notify = vi.hoisted(() => ({ pushNtfy: vi.fn(async (..._a: string[]) => true), ntfyTopic: vi.fn(async () => 'topic') }));
vi.mock('./notify.js', () => notify);
import { cancelFocus, scheduleFocus } from './focus.js';

const MIN = 60_000;

describe('focus push', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    notify.pushNtfy.mockClear();
    notify.ntfyTopic.mockResolvedValue('topic');
  });
  afterEach(() => {
    cancelFocus();
    vi.useRealTimers();
  });

  it('sends one push at end', async () => {
    expect(scheduleFocus('Write', Date.now() + 25 * MIN)).toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(25 * MIN - 1);
    expect(notify.pushNtfy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(notify.pushNtfy).toHaveBeenCalledTimes(1);
    expect(notify.pushNtfy.mock.calls[0][0]).toBe('Focus done: Write');
  });

  it('cancel and a second schedule drop the first', async () => {
    scheduleFocus('A', Date.now() + 10 * MIN);
    cancelFocus();
    await vi.advanceTimersByTimeAsync(11 * MIN);
    expect(notify.pushNtfy).not.toHaveBeenCalled();
    scheduleFocus('A', Date.now() + 10 * MIN);
    scheduleFocus('B', Date.now() + 12 * MIN);
    await vi.advanceTimersByTimeAsync(13 * MIN);
    expect(notify.pushNtfy).toHaveBeenCalledTimes(1);
    expect(notify.pushNtfy.mock.calls[0][0]).toBe('Focus done: B');
  });

  it('sends nothing when end is past', async () => {
    expect(scheduleFocus('A', Date.now() - 1000)).toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(MIN);
    expect(notify.pushNtfy).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric end or one over 25 minutes', () => {
    expect(scheduleFocus('A', 'soon')).toHaveProperty('error');
    expect(scheduleFocus('A', Date.now() + 26 * MIN)).toHaveProperty('error');
    expect(scheduleFocus('A', Date.now() + 25 * MIN + 5000)).toEqual({ ok: true });
  });

  it('sends nothing without an ntfy topic', async () => {
    notify.ntfyTopic.mockResolvedValue('off');
    expect(scheduleFocus('A', Date.now() + MIN)).toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(2 * MIN);
    expect(notify.pushNtfy).not.toHaveBeenCalled();
  });
});
