import { describe, expect, test } from 'bun:test';
import { openDb } from './db.js';
import { applyChanges } from './sync.js';
import { canRead, dueJobs, endInterrupted, nextRun } from './jobs.js';

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

describe('nextRun', () => {
  // Mon 26 Oct 2026, 10:00
  const now = at(2026, 10, 26, 10);
  test('daily runs later today or tomorrow', () => {
    expect(nextRun('daily 16:00', now)).toBe(at(2026, 10, 26, 16));
    expect(nextRun('daily 07:30', now)).toBe(at(2026, 10, 27, 7, 30));
  });
  test('daily keeps its hour across the spring-forward change', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'Europe/Oslo';
    try {
      expect(nextRun('daily 02:30', at(2026, 3, 29, 3, 40))).toBe(at(2026, 3, 30, 2, 30));
    } finally {
      process.env.TZ = tz;
    }
  });
  test('weekdays skip the weekend', () => {
    expect(nextRun('weekdays 07:30', at(2026, 10, 30, 9))).toBe(at(2026, 11, 2, 7, 30));
  });
  test('weekly lands on its day', () => {
    expect(nextRun('weekly fri 16:00', now)).toBe(at(2026, 10, 30, 16));
    expect(nextRun('weekly mon 09:00', now)).toBe(at(2026, 11, 2, 9));
  });
  test('hourly is the next full hour', () => {
    expect(nextRun('hourly', at(2026, 10, 26, 10, 15))).toBe(at(2026, 10, 26, 11));
  });
  test('a bad schedule has no next run', () => {
    expect(nextRun('sometimes', now)).toBeNull();
    expect(nextRun('daily 25:00', now)).toBeNull();
  });
});

describe('dueJobs', () => {
  test('plans enabled jobs and returns the due ones, including Run now on a job that is off', () => {
    const db = openDb(':memory:');
    const now = at(2026, 10, 26, 10);
    applyChanges(db, [
      { table: 'jobs', id: 'a', profile: 'work', updated_at: 1, fields: { name: 'A', schedule: 'daily 09:00', prompt: 'x', enabled: 1 } },
      { table: 'jobs', id: 'b', profile: 'work', updated_at: 1, fields: { name: 'B', schedule: 'daily 09:00', prompt: 'x', enabled: 1, next_run_at: now - 1 } },
      { table: 'jobs', id: 'c', profile: 'work', updated_at: 1, fields: { name: 'C', schedule: 'daily 09:00', prompt: 'x', enabled: 0, next_run_at: now - 1 } },
      { table: 'jobs', id: 'd', profile: 'work', updated_at: 1, fields: { name: 'D', schedule: 'daily 09:00', prompt: 'x', enabled: 0 } },
    ]);
    expect(dueJobs(db, now).map((j) => j.id)).toEqual(['b', 'c']);
    expect((db.prepare("SELECT next_run_at FROM jobs WHERE id = 'a'").get() as { next_run_at: number }).next_run_at).toBe(at(2026, 10, 27, 9));
  });
  test('a run cut off by a restart is marked failed', () => {
    const db = openDb(':memory:');
    applyChanges(db, [{ table: 'runs', id: 'r', profile: 'work', updated_at: 1, fields: { job_id: 'a', started_at: 1, status: 'running' } }]);
    endInterrupted(db, 2);
    expect((db.prepare("SELECT status FROM runs WHERE id = 'r'").get() as { status: string }).status).toBe('error');
  });
});

describe('canRead', () => {
  test('allows read tools, also when named after their server', () => {
    for (const t of ['mcp__claude_ai_Slack__slack_read_channel', 'mcp__claude_ai_Slack__slack_search_public_and_private', 'mcp__claude_ai_Slack__slack_list_user_channels', 'mcp__claude_ai_Gmail__search_threads', 'mcp__linear__list_issues']) expect(canRead(t)).toBe(true);
  });
  test('denies writes', () => {
    for (const t of ['mcp__claude_ai_Slack__slack_send_message', 'mcp__claude_ai_Slack__slack_create_list', 'mcp__claude_ai_Gmail__send_message', 'mcp__linear__create_issue', 'Bash']) expect(canRead(t)).toBe(false);
  });
});
