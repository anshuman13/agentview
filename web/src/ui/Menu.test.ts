import { describe, expect, it } from 'vitest';
import { menuClass } from './Menu';

describe('menuClass', () => {
  it('is the sheet on a phone', () => {
    expect(menuClass(true)).toBe('ui-menu sheet');
  });

  it('is the popover on desktop', () => {
    expect(menuClass(false)).toBe('ui-menu');
  });

  it('keeps the caller class', () => {
    expect(menuClass(true, 'x')).toBe('ui-menu sheet x');
    expect(menuClass(false, 'x')).toBe('ui-menu x');
  });
});
