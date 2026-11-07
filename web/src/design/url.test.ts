import { describe, expect, it } from 'vitest';
import { blockLink, designSearch, parseDesignQuery } from './url';

describe('design url', () => {
  it('parses known values and ignores unknown ones', () => {
    expect(parseDesignQuery('?theme=light&width=phone&bare')).toEqual({ theme: 'light', width: 'phone', bare: true });
    expect(parseDesignQuery('?theme=x&width=y')).toEqual({ theme: undefined, width: 'desktop', bare: false });
    expect(parseDesignQuery('')).toEqual({ theme: undefined, width: 'desktop', bare: false });
  });

  it('updates one part and keeps the rest', () => {
    expect(designSearch('?theme=dark&other=1', { width: 'phone' })).toBe('?theme=dark&other=1&width=phone');
    expect(designSearch('', {})).toBe('');
    expect(designSearch('?theme=dark', { theme: 'light' })).toBe('?theme=light');
  });

  it('builds a block link without bare', () => {
    expect(blockLink('http://h', '?bare&theme=dark', 'chip', 'light', 'phone')).toBe('http://h/design?theme=light&width=phone#chip');
  });
});
