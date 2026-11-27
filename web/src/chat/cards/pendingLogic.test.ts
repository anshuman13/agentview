import { describe, expect, it } from 'bun:test';
import { lineDiff } from '../../../../shared/lineDiff';

describe('lineDiff', () => {
  it('keeps shared lines and puts removals before additions', () => {
    expect(lineDiff('a\nb\nc', 'a\nB\nc')).toEqual([[' ', 'a'], ['-', 'b'], ['+', 'B'], [' ', 'c']]);
  });
});
