import { describe, expect, it } from 'vitest';
import { offlineBanner, type OfflineEvent, type OfflineState } from './offlineBanner';

const table: Array<[OfflineState, OfflineEvent, OfflineState]> = [
  ['hidden', 'down', 'pending'],
  ['hidden', 'elapsed', 'hidden'],
  ['hidden', 'up', 'hidden'],
  ['pending', 'down', 'pending'],
  ['pending', 'elapsed', 'shown'],
  ['pending', 'up', 'hidden'],
  ['shown', 'down', 'shown'],
  ['shown', 'elapsed', 'shown'],
  ['shown', 'up', 'hidden'],
];

describe('offlineBanner', () => {
  it.each(table)('%s + %s -> %s', (state, event, next) => {
    expect(offlineBanner(state, event)).toBe(next);
  });

  it('down then up while pending ends hidden', () => {
    expect(offlineBanner(offlineBanner('hidden', 'down'), 'up')).toBe('hidden');
  });
});
