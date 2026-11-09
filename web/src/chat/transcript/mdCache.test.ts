import { describe, expect, it } from 'vitest';
import { cachedHtml, mdKey, storeHtml } from './mdCache';

describe('markdown cache', () => {
  it('hits on the same id and text and misses on changed text', () => {
    storeHtml(mdKey('a', 'one'), '<p>one</p>');
    expect(cachedHtml(mdKey('a', 'one'))).toBe('<p>one</p>');
    expect(cachedHtml(mdKey('a', 'two'))).toBeUndefined();
  });

  it('evicts the oldest entry on the 501st insert', () => {
    for (let i = 0; i < 500; i++) storeHtml(mdKey(`e${i}`, 't'), `h${i}`);
    expect(cachedHtml(mdKey('e0', 't'))).toBe('h0');
    for (let i = 0; i < 500; i++) storeHtml(mdKey(`f${i}`, 't'), `h${i}`);
    storeHtml(mdKey('g', 't'), 'g');
    expect(cachedHtml(mdKey('f0', 't'))).toBeUndefined();
    expect(cachedHtml(mdKey('g', 't'))).toBe('g');
  });
});
