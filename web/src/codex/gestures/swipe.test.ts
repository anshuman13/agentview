import { describe, expect, it } from 'bun:test';
import { swipeEnd } from './Swipe';

const all = { right: true, left: true, delete: true };

describe('swipeEnd', () => {
  it('fires right past 80 px and nothing under it', () => {
    expect(swipeEnd(81, 300, all)).toBe('right');
    expect(swipeEnd(79, 300, all)).toBeNull();
    expect(swipeEnd(81, 300, { ...all, right: false })).toBeNull();
  });

  it('left snoozes until past the delete share of the row, then deletes', () => {
    expect(swipeEnd(-100, 300, all)).toBe('left');
    expect(swipeEnd(-170, 300, all)).toBe('delete');
    expect(swipeEnd(-170, 300, { ...all, delete: false })).toBe('left');
  });

  it('a row with no left action deletes on any left swipe past 80 px', () => {
    expect(swipeEnd(-100, 300, { ...all, left: false })).toBe('delete');
    expect(swipeEnd(-100, 300, { right: true, left: false, delete: false })).toBeNull();
  });
});
