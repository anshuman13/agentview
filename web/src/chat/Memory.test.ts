import { describe, expect, it } from 'vitest';
import { memoryWhere } from './Memory';

describe('memoryWhere', () => {
  it('names the repo, the account and memory files', () => {
    expect(memoryWhere({ path: '/r/CLAUDE.md' }, '/r')).toBe('Repo instructions');
    expect(memoryWhere({ path: '/u/.claude-alt/CLAUDE.md' }, '/r')).toBe('Global instructions · .claude-alt');
    expect(memoryWhere({ path: '/u/.claude/projects/-r/memory/git.md' }, '/r')).toBe('Memory · .claude');
  });
});
