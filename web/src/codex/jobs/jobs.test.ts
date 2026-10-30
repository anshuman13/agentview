import type { Job, Run } from '../data/wiki';
import { describe as group, expect, test } from 'vitest';
import { describe, queued, parseSchedule, scheduleOf } from './Jobs';

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

group('queued', () => {
  const job = { id: 'j', profile: 'work', next_run_at: 100 } as Job;
  const run = (status: string) => ({ id: 'r', profile: 'work', job_id: 'j', status, deleted: 0 }) as Run;
  test('a past next run with nothing running', () => {
    expect(queued(job, [], 200)).toBe(true);
    expect(queued(job, [run('ok')], 200)).toBe(true);
    expect(queued(job, [run('running')], 200)).toBe(false);
    expect(queued(job, [], 50)).toBe(false);
    expect(queued({ ...job, next_run_at: null }, [], 200)).toBe(false);
  });
});
