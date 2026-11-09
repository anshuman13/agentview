import { beforeEach, describe, expect, it, vi } from 'vitest';
import { linkPath, linksIn, linkTitle, resetLinkTitles } from './links';

const api = vi.hoisted(() => ({ fetchJson: vi.fn() }));
vi.mock('../../../app/api', () => ({ apiUrl: (p: string) => p, fetchJson: api.fetchJson }));

describe('linksIn', () => {
  it('finds bare and Markdown links in order, without duplicates', () => {
    expect(linksIn('see [Doc](https://a.test/x) and https://b.test/y, then https://a.test/x')).toEqual(['https://a.test/x', 'https://b.test/y']);
  });

  it('strips trailing punctuation', () => {
    expect(linksIn('Read https://a.test/p. Also (https://b.test/q); https://c.test/r:')).toEqual(['https://a.test/p', 'https://b.test/q', 'https://c.test/r']);
  });

  it('drops the final parenthesis of a URL that ends in one', () => {
    expect(linksIn('https://x.com/a_(b)')).toEqual(['https://x.com/a_(b']);
  });

  it('ignores other schemes and counts checklist lines', () => {
    expect(linksIn('ftp://a.test/f mailto:a@b.test\n- [ ] call http://c.test/z')).toEqual(['http://c.test/z']);
  });

  it('cuts at 8 unless unlimited', () => {
    const nine = Array.from({ length: 9 }, (_, i) => `https://a.test/${i}`).join(' ');
    expect(linksIn(nine)).toHaveLength(8);
    expect(linksIn(nine)[7]).toBe('https://a.test/7');
    expect(linksIn(nine, Infinity)).toHaveLength(9);
  });
});

describe('linkPath', () => {
  it('is empty for the root and cut at 40 characters', () => {
    expect(linkPath('https://a.test/')).toBe('');
    expect(linkPath(`https://a.test/${'p'.repeat(60)}`)).toHaveLength(43);
  });
});

describe('linkTitle', () => {
  beforeEach(() => { resetLinkTitles(); api.fetchJson.mockReset(); });

  it('asks once per URL, even after a failure', async () => {
    api.fetchJson.mockResolvedValueOnce({ title: 'A' }).mockRejectedValueOnce(new Error('down'));
    expect(await linkTitle('https://a.test/1')).toBe('A');
    expect(await linkTitle('https://a.test/1')).toBe('A');
    expect(await linkTitle('https://a.test/2')).toBeNull();
    expect(await linkTitle('https://a.test/2')).toBeNull();
    expect(api.fetchJson).toHaveBeenCalledTimes(2);
  });

  it('runs at most 3 requests at once', async () => {
    let open = 0;
    let peak = 0;
    api.fetchJson.mockImplementation(async () => {
      peak = Math.max(peak, ++open);
      await new Promise((r) => setTimeout(r, 5));
      open--;
      return { title: 't' };
    });
    await Promise.all(Array.from({ length: 7 }, (_, i) => linkTitle(`https://a.test/${i}`)));
    expect(peak).toBe(3);
  });
});
