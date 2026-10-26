import { describe as group, expect, test } from 'vitest';
import { describe, parseSchedule, scheduleOf } from './Jobs';

group('job schedules', () => {
  test('read back what the form writes', () => {
    expect(parseSchedule(scheduleOf('weekly', 'fri', '16:00'))).toEqual({ kind: 'weekly', day: 'fri', time: '16:00' });
    expect(scheduleOf('hourly', 'mon', '08:00')).toBe('hourly');
  });
  test('describe in words', () => {
    expect(describe('weekdays 07:30')).toBe('Weekdays at 07:30');
    expect(describe('weekly fri 16:00')).toBe('Fridays at 16:00');
    expect(describe('daily 9:05')).toBe('Every day at 09:05');
    expect(describe('hourly')).toBe('Every hour');
  });
});
