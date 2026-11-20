import { describe, expect, it } from 'bun:test';
import { appendRule, removeRule } from './steering';

describe('removeRule', () => {
  it('removes only the last matching bullet and keeps later edits', () => {
    const added = appendRule('# Rules\n- Use bun.\n', 'Use bun.')!;
    expect(removeRule(`${added}- Later edit.\n`, 'Use bun.')).toBe('# Rules\n- Use bun.\n- Later edit.\n');
    expect(removeRule(added, '  Use   bun. ')).toBe('# Rules\n- Use bun.\n');
  });

  it('is null when the bullet is gone', () => {
    expect(removeRule('# Rules\n', 'Use bun.')).toBeNull();
  });
});
