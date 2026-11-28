import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { PRICES, costOf, type Price, type TurnTokens } from './prices.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/prices.json', import.meta.url), 'utf8')) as {
  prices: Record<string, Price>;
  cases: { name: string; tokens: TurnTokens; expected: number | null }[];
};

describe('costOf', () => {
  it('has the fixture price table', () => {
    expect(PRICES).toEqual(fx.prices);
  });

  for (const c of fx.cases) {
    it(c.name, () => {
      const got = costOf(c.tokens);
      if (c.expected === null) expect(got).toBeNull();
      else expect(got).toBeCloseTo(c.expected, 9);
    });
  }
});
