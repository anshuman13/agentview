import { expect, test } from 'vitest';
import { parseSchedule, scheduleOf } from '../jobs/Jobs';
import { DIGEST_SECTIONS, WEEKLY_DIGEST } from './presets';

const HUB_SCHEDULE = /^(hourly|(daily|weekdays|weekly (sun|mon|tue|wed|thu|fri|sat)) ([01]?\d|2[0-3]):[0-5]\d)$/;

test('weekly digest schedule is one the hub scheduler accepts', () => {
  expect(WEEKLY_DIGEST.schedule).toMatch(HUB_SCHEDULE);
  const { kind, day, time } = parseSchedule(WEEKLY_DIGEST.schedule);
  expect(scheduleOf(kind, day, time)).toBe('weekly fri 16:00');
});

test('weekly digest prompt asks for every section', () => {
  expect(WEEKLY_DIGEST.name).toBe('Weekly digest');
  for (const s of DIGEST_SECTIONS) expect(WEEKLY_DIGEST.prompt).toContain(s);
  expect(WEEKLY_DIGEST.prompt).not.toContain('—');
});
