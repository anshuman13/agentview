import { describe, expect, it } from 'vitest';
import type { Fact } from '../data/wiki';
import { actionsFor } from './shared';

const fact = (over: Partial<Fact> = {}) => ({ id: 'f', state: null, contested: null, ...over }) as Fact;
const contested = JSON.stringify({ by: 'you', at: 1, note: '' });

describe('actionsFor', () => {
  it('gives a normal claim More with Retire last', () => {
    expect(actionsFor(fact())).toEqual({ buttons: ['more'], menu: ['edit', 'cite', 'contest', 'retire'] });
  });

  it('gives a proposed claim Reject and Approve and no menu, contested or not', () => {
    const want = { buttons: ['reject', 'approve'], menu: [] };
    expect(actionsFor(fact({ state: 'proposed' }))).toEqual(want);
    expect(actionsFor(fact({ state: 'proposed', contested }))).toEqual(want);
  });

  it('adds Resolve before Retire on a contested claim', () => {
    expect(actionsFor(fact({ contested }))).toEqual({ buttons: ['more'], menu: ['edit', 'cite', 'resolve', 'retire'] });
  });

  it('gives a stale claim Confirm and More, with Resolve when contested', () => {
    expect(actionsFor(fact(), { stale: true })).toEqual({ buttons: ['confirm', 'more'], menu: ['edit', 'cite', 'contest', 'retire'] });
    expect(actionsFor(fact({ contested }), { stale: true }).menu).toEqual(['edit', 'cite', 'resolve', 'retire']);
  });

  it('keeps Confirm and More on a stale proposed claim', () => {
    expect(actionsFor(fact({ state: 'proposed' }), { stale: true }).buttons).toEqual(['confirm', 'more']);
  });

  it('gives a retired claim More with Restore last, with Resolve when contested', () => {
    expect(actionsFor(fact({ state: 'retired' }))).toEqual({ buttons: ['more'], menu: ['edit', 'cite', 'contest', 'restore'] });
    expect(actionsFor(fact({ state: 'retired', contested }))).toEqual({ buttons: ['more'], menu: ['edit', 'cite', 'resolve', 'restore'] });
  });

  it('hides Edit while editing and Contest while contesting', () => {
    expect(actionsFor(fact(), { editing: true, contesting: true }).menu).toEqual(['cite', 'retire']);
  });
});
