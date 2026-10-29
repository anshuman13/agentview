import { describe, expect, it } from 'vitest';
import { actionCount, actionCounts } from './wiki';
import type { ItemRow } from './sync';

const STATUS = ['open', 'done', 'suggested', 'unassigned', 'dismissed', null];

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `i${i}`, profile: i % 2 ? 'work' : 'personal', meeting_id: i % 7 === 0 ? null : `m${i % 200}`,
    status: STATUS[i % STATUS.length], deleted: i % 11 === 0 ? 1 : 0,
  }) as unknown as ItemRow);

describe('actionCounts', () => {
  it('matches actionCount per meeting', () => {
    const items = rows(5000);
    for (const [k, c] of actionCounts(items)) {
      const at = k.indexOf(':');
      expect(c).toEqual(actionCount(items, { profile: k.slice(0, at) as ItemRow['profile'], id: k.slice(at + 1) }));
    }
  });

});
