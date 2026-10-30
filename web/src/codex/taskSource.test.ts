import { expect, it } from 'vitest';
import { sourceOf } from './taskSource';
import type { ItemRow } from './data/sync';

it('labels promises You said and asks Slack', () => {
  expect(sourceOf({ id: 'said:1', source: 'slack' } as ItemRow).label).toBe('You said');
  expect(sourceOf({ id: 'ask:1', source: 'slack' } as ItemRow).label).toBe('Slack');
});
