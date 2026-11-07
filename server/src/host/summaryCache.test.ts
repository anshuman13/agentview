import { afterEach, expect, it, vi } from 'vitest';
import { chatCost, costByModel } from '../../../shared/cost.js';
import type { ChatEvent } from '../../../shared/protocol.js';
import { costScans, costsOf } from './summaryCache.js';

const result = (costUsd: number, model = 'm') => ({ kind: 'result', costUsd, at: Date.now(), model, durationMs: 1 }) as unknown as ChatEvent;
const day = new Date().setHours(0, 0, 0, 0);

afterEach(() => vi.restoreAllMocks());

it('scans once per events array, length and day start', () => {
  const chat = vi.spyOn(costScans, 'chatCost');
  const by = vi.spyOn(costScans, 'costByModel');
  const events = [result(1)];
  const a = costsOf(events, day);
  expect(costsOf(events, day)).toBe(a);
  expect(chat).toHaveBeenCalledTimes(1);
  expect(by).toHaveBeenCalledTimes(1);
});

it('recomputes only the chat that changed', () => {
  const chat = vi.spyOn(costScans, 'chatCost');
  const a = [result(1)];
  const b = [result(2)];
  costsOf(a, day);
  costsOf(b, day);
  chat.mockClear();
  a.push(result(3));
  costsOf(a, day);
  costsOf(b, day);
  expect(chat).toHaveBeenCalledTimes(1);
});

it('recomputes for a replaced array or a new day start', () => {
  const chat = vi.spyOn(costScans, 'chatCost');
  const a = [result(1)];
  costsOf(a, day);
  costsOf([...a], day);
  costsOf(a, day - 1);
  expect(chat).toHaveBeenCalledTimes(3);
});

it('matches direct scans', () => {
  const events = [result(1), result(3, 'n')];
  const got = costsOf(events, day);
  expect(got.cost).toBe(chatCost(events));
  expect(got.spend).toEqual(costByModel(events, day, Date.now()));
});
