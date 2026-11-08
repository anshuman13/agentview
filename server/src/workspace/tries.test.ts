import { describe, expect, it } from 'vitest';
import { parseTries, triesBranches } from './tries.js';

describe('tries', () => {
  it('parses a count of 2 to 4 and the prompt', () => {
    expect(parseTries('/tries 3 fix the\nlogin bug')).toEqual({ n: 3, prompt: 'fix the\nlogin bug' });
    expect(parseTries('/tries 5 x')).toBe('usage');
    expect(parseTries('/tries')).toBe('usage');
    expect(parseTries('/triesx 2 a')).toBeNull();
    expect(parseTries('fix it')).toBeNull();
  });

  it('names one branch per try from the prompt', () => {
    expect(triesBranches('Fix the Login bug, please now', 2, new Date('2026-11-08T21:05:00Z'))).toEqual(['tries/fix-the-login-bug-11082105-1', 'tries/fix-the-login-bug-11082105-2']);
    expect(triesBranches('!!!', 1, new Date('2026-11-08T21:05:00Z'))).toEqual(['tries/try-11082105-1']);
  });
});
