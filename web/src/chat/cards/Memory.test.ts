import { describe, expect, it } from 'bun:test';
import { memoryWhere, ruleFile } from './Memory';

describe('memoryWhere', () => {
  it('names the repo, the account and memory files', () => {
    expect(memoryWhere({ path: '/r/CLAUDE.md' }, '/r')).toBe('Repo instructions');
    expect(memoryWhere({ path: '/u/.claude-alt/CLAUDE.md' }, '/r')).toBe('Global instructions · .claude-alt');
    expect(memoryWhere({ path: '/u/.claude/projects/-r/memory/git.md' }, '/r')).toBe('Memory · .claude');
    expect(memoryWhere({ path: '/r/AGENTS.md' }, '/r')).toBe('Repo instructions');
    expect(memoryWhere({ path: '/u/.codex/AGENTS.md' }, '/r')).toBe('Global instructions · .codex');
  });
});

describe('ruleFile', () => {
  it('is the first instruction file as a path in the folder', () => {
    expect(ruleFile('/r', ['/r/AGENTS.md', '/u/.codex/AGENTS.md'])).toBe('AGENTS.md');
    expect(ruleFile('/r', undefined)).toBe('CLAUDE.md');
  });
});
