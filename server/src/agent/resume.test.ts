import { describe, expect, it } from 'vitest';
import { claudeResume, codexResume } from './resume.js';

describe('resume commands', () => {
  it('resume a Claude chat in its folder on its account', () => {
    expect(claudeResume('/Users/me/repo', 'abc', 'main')).toBe('cd /Users/me/repo && claude --resume abc');
    expect(claudeResume("/Users/me/my repo's", 'abc', 'alt')).toBe("cd '/Users/me/my repo'\\''s' && CLAUDE_CONFIG_DIR=~/.claude-alt claude --resume abc");
  });
  it('resume a Codex chat in its folder', () => {
    expect(codexResume('/a b', 't1')).toBe("cd '/a b' && codex resume t1");
  });
});
