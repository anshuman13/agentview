import { describe, expect, it } from 'bun:test';
import type { ChatEvent } from './protocol.js';
import { costByModel } from './cost.js';

const DAY = 24 * 3600 * 1000;
const now = Date.UTC(2026, 10, 10, 15);
const todayStart = Date.UTC(2026, 10, 10, 12);
const r = (costUsd: number, at: number, model?: string | null): ChatEvent => ({ id: `${at}-${costUsd}`, kind: 'result', text: '', costUsd, isError: false, at, ...(model !== undefined && { model }) });

describe('costByModel', () => {
  it('keys a missing or null model as Unknown', () => {
    expect(costByModel([r(1, now), r(2, now, null)], todayStart, now).today).toEqual({ Unknown: 2 });
  });

  it('splits by model and window, handles /clear and old results', () => {
    const events = [
      r(1, now - 10 * DAY, 'a'),
      r(3, now - 2 * DAY, 'a'),
      r(5, now - 1, 'b'),
      r(1, now, 'b'),
      r(0, now, 'c'),
    ];
    expect(costByModel(events, todayStart, now)).toEqual({ today: { b: 3 }, week: { a: 2, b: 3 } });
  });

  it('puts a later rise under the new model', () => {
    expect(costByModel([r(1, now, 'a'), r(3, now, 'b')], todayStart, now).today).toEqual({ a: 1, b: 2 });
  });

  it('uses todayStart as an inclusive boundary', () => {
    const w = costByModel([r(1, todayStart - 1, 'a'), r(2, todayStart, 'a')], todayStart, now);
    expect(w).toEqual({ today: { a: 1 }, week: { a: 2 } });
  });

  it('counts the whole first kept total after a trim', () => {
    expect(costByModel([r(5, now, 'a')], todayStart, now).week).toEqual({ a: 5 });
  });
});
