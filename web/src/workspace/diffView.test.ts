import { describe, expect, test } from 'bun:test';
import { diffPath, toggled } from './diffView';

describe('diffView', () => {
  test('toggled adds and removes a path without changing the input', () => {
    const open = new Set(['a']);
    expect([...toggled(open, 'b')]).toEqual(['a', 'b']);
    expect([...toggled(open, 'a')]).toEqual([]);
    expect([...open]).toEqual(['a']);
  });

  test('diffPath passes the base and ws=0 only when set', () => {
    expect(diffPath('branch', { base: undefined }, false)).toBe('/api/git/branch');
    expect(diffPath('branch', { base: 'feat/x y' }, true)).toBe('/api/git/branch?base=feat%2Fx%20y&ws=0');
    expect(diffPath('show', { hash: 'abc123' }, false)).toBe('/api/git/show?hash=abc123');
  });
});
