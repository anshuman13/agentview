import { describe, expect, it } from 'bun:test';
import type { ChatEvent } from './protocol.js';
import type { TurnTokens } from './prices.js';
import { chatCost, costByModel } from './cost.js';

const DAY = 24 * 3600 * 1000;
const now = Date.UTC(2026, 10, 10, 15);
const todayStart = Date.UTC(2026, 10, 10, 12);
// gpt-6-luna output is 0.5 per million tokens, so n dollars is 2e6 * n output tokens.
const usd = (n: number): TurnTokens => ({ model: 'gpt-6-luna', input: 0, cachedInput: 0, cacheWrite: 0, output: n * 2e6, reasoning: 0 });
const r = (cost: number, at: number, model?: string | null): ChatEvent => ({ id: `${at}-${cost}`, kind: 'result', text: '', tokens: usd(cost), isError: false, at, ...(model !== undefined && { model }) });

describe('chatCost', () => {
  it('adds every result priced from its tokens and skips results without tokens', () => {
    const bare: ChatEvent = { id: 'x', kind: 'result', text: '', isError: false, at: now };
    expect(chatCost([r(1, now), bare, r(0.5, now)])).toBeCloseTo(1.5);
  });

  it('counts nothing for an unpriced model', () => {
    const e: ChatEvent = { id: 'x', kind: 'result', text: '', tokens: { ...usd(1), model: 'mystery' }, isError: false, at: now };
    expect(chatCost([e])).toBe(0);
  });
});

describe('costByModel', () => {
  it('keys a null model by the tokens model', () => {
    expect(costByModel([r(1, now), r(2, now, null)], todayStart, now).today).toEqual({ 'gpt-6-luna': 3 });
  });

  it('splits by model and window and skips old results', () => {
    const events = [r(1, now - 10 * DAY, 'a'), r(2, now - 2 * DAY, 'a'), r(3, now - 1, 'b'), r(0, now, 'c')];
    expect(costByModel(events, todayStart, now)).toEqual({ today: { b: 3 }, week: { a: 2, b: 3 } });
  });

  it('uses todayStart as an inclusive boundary', () => {
    const w = costByModel([r(1, todayStart - 1, 'a'), r(2, todayStart, 'a')], todayStart, now);
    expect(w).toEqual({ today: { a: 2 }, week: { a: 3 } });
  });
});
