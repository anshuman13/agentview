import { describe, expect, it } from 'vitest';
import { macUrl } from './api';

describe('macUrl', () => {
  const macbook = 'http://anshumans-macbook-pro.netbird.cloud:7777';

  it('opens the Mac the user sits at on localhost', () => {
    expect(macUrl({ url: macbook, self: true }, '7777')).toBe('http://localhost:7777');
    expect(macUrl({ url: macbook, self: true }, '')).toBe('http://localhost');
  });

  it('opens another Mac on its NetBird address', () => {
    expect(macUrl({ url: macbook, self: false }, '7777')).toBe(macbook);
    expect(macUrl({ url: macbook }, '7777')).toBe(macbook);
  });
});
