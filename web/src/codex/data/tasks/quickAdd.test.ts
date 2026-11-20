import { describe, expect, it } from 'bun:test';
import { captureChips, parseCapture } from './quickAdd';

describe('captureChips', () => {
  const now = new Date(2026, 10, 20, 10, 0);
  it('shows the repeat, tags and estimate typed so far', () => {
    expect(captureChips(parseCapture('water plants every day #home 30m', now))).toEqual([['sync', 'every day 09:00'], ['tag', 'home'], ['watch', '30m']]);
  });
  it('shows nothing for a plain title', () => {
    expect(captureChips(parseCapture('call mum', now))).toEqual([]);
  });
});
