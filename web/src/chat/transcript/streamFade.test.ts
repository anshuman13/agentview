import { describe, expect, it } from 'bun:test';
import { FADE_MS, fadeRanges, nextTails } from './streamFade';

describe('stream fade', () => {
  it('adds a tail for new text and keeps the older one at its point in the fade', () => {
    const a = nextTails([], 0, 10, 1000);
    const b = nextTails(a, 10, 16, 1100);
    expect(b).toEqual([{ start: 0, at: 1000 }, { start: 10, at: 1100 }]);
    expect(fadeRanges(b, 16, 1100)).toEqual([{ start: 0, end: 10, delay: -100 }, { start: 10, end: 16, delay: 0 }]);
  });

  it('drops tails that finished fading so finished text is not wrapped again', () => {
    const t = nextTails([{ start: 0, at: 0 }], 10, 12, FADE_MS + 1);
    expect(fadeRanges(t, 12, FADE_MS + 1)).toEqual([{ start: 10, end: 12, delay: 0 }]);
  });

  it('adds nothing when the text did not grow', () => {
    expect(nextTails([], 8, 8, 0)).toEqual([]);
  });
});
