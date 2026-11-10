import { describe, expect, test } from 'vitest';
import { checkFields, dataWriteTool } from './data.js';

describe('checkFields', () => {
  test('turns date strings into epoch ms and replans a rescheduled job', () => {
    const f: Record<string, string | number | null> = { schedule: '*/15 0-8 * * *', at: '2026-11-02T00:00:00Z' };
    expect(checkFields('jobs', f)).toBeNull();
    expect(f).toEqual({ schedule: '*/15 0-8 * * *', at: Date.UTC(2026, 10, 2), next_run_at: null });
  });
  test('rejects a schedule that never runs', () => {
    expect(checkFields('jobs', { schedule: '16 20 1 11' })).toMatch(/never runs/);
    expect(checkFields('jobs', { schedule: 'once 2026-11-01 20:16' }, Date.UTC(2026, 10, 2))).toMatch(/never runs/);
  });
});

describe('data_write', () => {
  test('rejects a job repo, which only the job page sets', async () => {
    const out = await dataWriteTool.handler({ table: 'jobs', fields: { repo: '/tmp/x' } }, { cwd: '/tmp' } as never);
    expect(out).toMatch(/Unknown fields for jobs: repo/);
  });
});
