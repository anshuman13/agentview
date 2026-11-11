import { describe, expect, it } from 'bun:test';
import { taskMatches } from './match';
import type { ItemRow } from '../sync';

const row = (extra: Partial<ItemRow>) => ({ id: 'i1', profile: 'work', title: 'Plan trip', text: null, people: null, tags: null, ...extra }) as ItemRow;

describe('taskMatches', () => {
  const tagged = row({ tags: 'faq needs-you' });

  it('matches single tags, with or without #, and tag substrings', () => {
    for (const q of ['faq', '#faq', 'needs', 'needs-you']) expect(taskMatches(tagged, q)).toBe(true);
    expect(taskMatches(tagged, 'access')).toBe(false);
  });

  it('does not match a space-joined pair of tags', () => {
    expect(taskMatches(tagged, 'faq needs-you')).toBe(false);
  });

  it('does not match tags on an empty query after the # is stripped', () => {
    expect(taskMatches(tagged, '#')).toBe(false);
    expect(taskMatches(row({ title: 'Fix #12' }), '#')).toBe(true);
  });

  it('handles null and empty tags', () => {
    for (const tags of [null, '']) {
      expect(taskMatches(row({ tags }), 'trip')).toBe(true);
      expect(taskMatches(row({ tags }), 'faq')).toBe(false);
    }
  });
});
