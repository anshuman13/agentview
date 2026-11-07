import { afterEach, describe, expect, it, vi } from 'vitest';
import { ago, copyText, escapeHtml, markSegments, matchLabel, modelLabel, money, spendLines, stepMatch, weekPace } from './util';

describe('ago', () => {
  afterEach(() => vi.useRealTimers());

  it('rounds to the largest unit and says now under a minute', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 24, 12, 0, 0));
    const now = Date.now();
    expect(ago(now - 30_000)).toBe('now');
    expect(ago(now - 5 * 60_000)).toBe('5m');
    expect(ago(now - 3 * 3_600_000, ' ago')).toBe('3h ago');
    expect(ago(new Date(now - 2 * 86_400_000).toISOString())).toBe('2d');
    expect(ago(now - 21 * 86_400_000)).toBe('3w');
    expect(ago('not a date')).toBe('not a date');
  });
});

describe('weekPace', () => {
  const reset = new Date('2026-10-31T08:00:00Z').getTime();
  const h = 3_600_000;
  it('grows by 100/7 a day, counted in whole hours', () => {
    expect(weekPace(reset, reset - 7 * 24 * h)).toBe(0);
    expect(weekPace(reset, reset - 6 * 24 * h)).toBe(14);
    expect(weekPace(reset, reset - 6 * 24 * h - 30 * 60_000)).toBe(14);
    expect(weekPace(reset, reset - 84 * h)).toBe(50);
    expect(weekPace(reset, reset)).toBe(100);
  });
});

describe('escapeHtml', () => {
  it('escapes markup and quotes', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });
});

describe('spend', () => {
  const models = [{ value: 'opus', displayName: 'Opus' }];

  it('formats money', () => {
    expect(money(0.004)).toBe('<$0.01');
    expect(money(0)).toBe('$0.00');
    expect(money(0.005)).toBe('$0.01');
    expect(money(12.4)).toBe('$12');
  });

  it('labels models', () => {
    expect(modelLabel('opus', models)).toBe('Opus');
    expect(modelLabel('claude-opus-4-1-20250805', models)).toBe('opus-4-1');
    expect(modelLabel('Unknown', models)).toBe('Unknown');
  });

  it('sums, sorts and totals spend lines', () => {
    const lines = spendLines(
      [
        { today: { opus: 1 }, week: { opus: 1, b: 1, a: 1, tiny: 0.001 } },
        undefined,
        { today: {}, week: { opus: 1.5, tiny: 0.001 } },
      ],
      models,
    );
    expect(lines).toEqual([
      'Spend',
      'Opus: today $1.00, 7 days $2.50',
      'a: today $0.00, 7 days $1.00',
      'b: today $0.00, 7 days $1.00',
      'Total: today $1.00, 7 days $4.50',
      'Counts chats open on the Mac since the host last started',
      "Today is the Mac's day",
    ]);
  });

  it('returns nothing without spend', () => {
    expect(spendLines([undefined, { today: {}, week: {} }], models)).toEqual([]);
  });
});

describe('markSegments', () => {
  const hits = (t: string, w: string[]) => markSegments(t, w).filter((s) => s.hit).map((s) => s.text);
  it('matches every case of a word', () => {
    expect(hits('Alpha alpha ALPHA', ['alpha'])).toEqual(['Alpha', 'alpha', 'ALPHA']);
  });
  it('matches several words and keeps the text unchanged', () => {
    const segs = markSegments('one two three', ['one', 'three']);
    expect(hits('one two three', ['one', 'three'])).toEqual(['one', 'three']);
    expect(segs.map((s) => s.text).join('')).toBe('one two three');
  });
  it('merges overlapping and touching words into one piece', () => {
    expect(hits('abcd', ['ab', 'bc'])).toEqual(['abc']);
    expect(hits('abcd', ['ab', 'cd'])).toEqual(['abcd']);
  });
  it('matches regex characters literally', () => {
    expect(hits('f(x) * 2', ['(', '*'])).toEqual(['(', '*']);
  });
  it('returns one plain piece for a blank query', () => {
    expect(markSegments('abc', [])).toEqual([{ text: 'abc', hit: false }]);
  });
});

describe('matchLabel', () => {
  it('words the count and caps it at 500', () => {
    expect([0, 1, 2, 500, 501].map(matchLabel)).toEqual(['No matches', '1 match', '2 matches', '500 matches', '500+ matches']);
  });
});

describe('stepMatch', () => {
  it('wraps at both ends and starts from the first or last match', () => {
    expect(stepMatch(-1, 1, 3)).toBe(0);
    expect(stepMatch(-1, -1, 3)).toBe(2);
    expect(stepMatch(2, 1, 3)).toBe(0);
    expect(stepMatch(0, -1, 3)).toBe(2);
  });
});

describe('copyText', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubDom(ok: boolean) {
    const body: unknown[] = [];
    const selected: string[] = [];
    const area = { value: '', select() { selected.push(this.value); }, remove() { body.splice(body.indexOf(area), 1); } };
    const execCommand = vi.fn(() => ok);
    vi.stubGlobal('document', { createElement: () => area, body: { appendChild: (el: unknown) => body.push(el) }, execCommand });
    return { body, selected, execCommand };
  }

  it('copies through a selected textarea and removes it when the clipboard API is missing', async () => {
    vi.stubGlobal('navigator', {});
    const { body, selected, execCommand } = stubDom(true);
    await expect(copyText('x')).resolves.toBeUndefined();
    expect(selected).toEqual(['x']);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(body).toHaveLength(0);
  });

  it('rejects when execCommand fails', async () => {
    vi.stubGlobal('navigator', {});
    const { body } = stubDom(false);
    await expect(copyText('x')).rejects.toThrow();
    expect(body).toHaveLength(0);
  });

  it('uses the clipboard API when present', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { execCommand } = stubDom(true);
    await copyText('x');
    expect(writeText).toHaveBeenCalledWith('x');
    expect(execCommand).not.toHaveBeenCalled();
  });
});
