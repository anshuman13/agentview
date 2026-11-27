import { describe, expect, it } from 'bun:test';
import { FADE_MS, fadeRanges, freshReplies, knownIds, nextTails } from './streamFade';

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

  it('treats text already there on the first render as shown and fades only later growth', () => {
    const a = nextTails([], null, 40, 1000);
    expect(fadeRanges(a, 40, 1000)).toEqual([]);
    expect(fadeRanges(nextTails(a, 40, 46, 1050), 46, 1050)).toEqual([{ start: 40, end: 46, delay: 0 }]);
  });

  it('fades the whole first chunk of a block that appeared mid-stream, which starts at length 0', () => {
    const a = nextTails([], 0, 12, 1000);
    expect(fadeRanges(a, 12, 1000)).toEqual([{ start: 0, end: 12, delay: 0 }]);
    expect(fadeRanges(nextTails([], null, 12, 1000), 12, 1000)).toEqual([]);
  });

  it('marks only replies that start streaming after the transcript showed items', () => {
    const user = { kind: 'user', id: 'u1' };
    const old = { kind: 'assistant', id: 'a1', streaming: true };
    expect(freshReplies(null, [user, old])).toEqual(new Set());
    let known = knownIds(knownIds(null, []), [user, old]);
    const next = { kind: 'assistant', id: 'a2', streaming: true };
    expect(freshReplies(known, [user, old, next])).toEqual(new Set(['a2']));
    known = knownIds(known, [user, old, next]);
    expect(freshReplies(known, [user, old, next])).toEqual(new Set());
    expect(freshReplies(known, [{ kind: 'assistant', id: 'a3', streaming: false }])).toEqual(new Set());
  });

  it('adds nothing when the text did not grow', () => {
    expect(nextTails([], 8, 8, 0)).toEqual([]);
  });
});
