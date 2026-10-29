process.env.TZ = 'Europe/Oslo';

import { expect, it } from 'vitest';
import { parseWhen } from './engine';

it('adds calendar days across the spring-forward change', () => {
  expect(parseWhen('in 2 days', new Date(2026, 2, 28, 9, 0))?.at).toBe(new Date(2026, 2, 30, 9, 0).getTime());
  expect(parseWhen('in 1 week', new Date(2026, 2, 25, 9, 0))?.at).toBe(new Date(2026, 3, 1, 9, 0).getTime());
});
