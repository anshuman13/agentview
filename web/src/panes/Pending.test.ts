import { describe, expect, it } from 'vitest';
import { lineDiff } from './Pending';

describe('lineDiff', () => {
  it('keeps shared lines and puts removals before additions', () => {
    expect(lineDiff('a\nb\nc', 'a\nB\nc')).toEqual([[' ', 'a'], ['-', 'b'], ['+', 'B'], [' ', 'c']]);
  });

  it('shows a new file as additions only', () => {
    expect(lineDiff('', 'x\ny')).toEqual([['+', 'x'], ['+', 'y']]);
  });
});
