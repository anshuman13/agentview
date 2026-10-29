import { describe, expect, it } from 'vitest';
import { DEFAULT_RECIPES, matchRecipes, recipeQuery } from './recipes';

describe('recipes', () => {
  it('only opens for a leading slash', () => {
    expect(recipeQuery('hello')).toBeNull();
    expect(recipeQuery(' /x')).toBeNull();
    expect(recipeQuery('/')).toBe('');
  });

  it('matches every word case-insensitively', () => {
    expect(matchRecipes(DEFAULT_RECIPES, '/OPEN dec').map((r) => r.id)).toEqual(['decisions']);
    expect(matchRecipes(DEFAULT_RECIPES, '/week meetings').map((r) => r.id)).toEqual(['week']);
  });

  it('returns nothing without a slash or a match', () => {
    expect(matchRecipes(DEFAULT_RECIPES, 'open')).toEqual([]);
    expect(matchRecipes(DEFAULT_RECIPES, '/zzz')).toEqual([]);
  });
});
