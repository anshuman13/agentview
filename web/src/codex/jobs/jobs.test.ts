import type { Job, Run } from '../data/wiki';
import { describe as group, expect, test } from 'vitest';
import { describe, queued, rowMeta, runMeta, parseSchedule, scheduleOf } from './schedule';

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

group('rowMeta', () => {
  const job = { id: 'j', profile: 'work', enabled: 1, next_run_at: null } as Job;
  test('queued shows Queued on or off, off shows Off', () => {
    expect(rowMeta({ ...job, enabled: 0, next_run_at: 100 }, [], 200)).toBe('Queued');
    expect(rowMeta({ ...job, enabled: 0 }, [], 200)).toBe('Off');
    expect(rowMeta({ ...job, next_run_at: 100 }, [], 200)).toBe('Queued');
  });
  test('an enabled job shows its next run when set', () => {
    expect(rowMeta({ ...job, next_run_at: 5000 }, [], 200)).toMatch(/^Next /);
    expect(rowMeta(job, [], 200)).toBeNull();
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

group('runMeta', () => {
  const run = (over: Partial<Run>) => ({ status: 'ok', started_at: 1000, finished_at: 13_000, cost: 0.04, ...over }) as Run;
  test('duration then cost', () => {
    expect(runMeta(run({}))).toBe('12 s · $0.04');
    expect(runMeta(run({ finished_at: 1400 }))).toBe('1 s · $0.04');
    expect(runMeta(run({ finished_at: 66_000 }))).toBe('1 min 5 s · $0.04');
  });
  test('no cost part for null or zero, no duration while running', () => {
    expect(runMeta(run({ cost: null }))).toBe('12 s');
    expect(runMeta(run({ cost: 0 }))).toBe('12 s');
    expect(runMeta(run({ status: 'running', finished_at: null }))).toBe('Running');
  });
});
