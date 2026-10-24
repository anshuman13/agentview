import { afterEach, describe, expect, it, vi } from 'vitest';
import { jobOf, track } from './Deploy';

const job = { id: 'j1', lines: ['start'], done: false, ok: false, url: '' };
const reply = (body: unknown) => Promise.resolve({ json: () => Promise.resolve(body) });

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('track', () => {
  it('keeps polling the job without a mounted pane and stops when it is done', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockReturnValueOnce(reply({ ...job, lines: ['start', 'build'] })).mockReturnValueOnce(reply({ ...job, lines: ['start', 'build', 'live'], done: true, ok: true }));
    vi.stubGlobal('fetch', fetch);
    track('/w/app', job, 10);
    await vi.advanceTimersByTimeAsync(10);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toContain('/api/deploy/job/j1');
    await vi.advanceTimersByTimeAsync(10);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(50);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(jobOf('/w/app')).toMatchObject({ done: true, ok: true, lines: ['start', 'build', 'live'] });
  });

  it('appends a server error to the log and stops', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockReturnValue(reply({ error: 'gone' }));
    vi.stubGlobal('fetch', fetch);
    track('/w/other', job, 10);
    await vi.advanceTimersByTimeAsync(30);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(jobOf('/w/other')).toMatchObject({ done: true, ok: false, lines: ['start', 'gone'] });
  });
});
