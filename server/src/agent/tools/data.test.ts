import { describe, expect, test, vi } from 'bun:test';
import { profileOf } from '../claude/accounts.js';

const hub = { rows: vi.fn(), push: vi.fn() };
vi.mock('../../integrations/assistant.js', () => ({ hubRows: hub.rows, hubPush: hub.push }));
const { checkFields, dataWriteTool } = await import('./data.js');

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
  test('refuses to change a job that has a repo, and still changes one without', async () => {
    const cwd = '/tmp';
    hub.rows.mockResolvedValue([{ id: 'a', profile: profileOf(cwd), repo: '/r' }, { id: 'b', profile: profileOf(cwd), repo: null }]);
    expect(await dataWriteTool.handler({ table: 'jobs', id: 'a', fields: { prompt: 'x' } }, { cwd } as never)).toBe('A job with a repo is changed on the job page only.');
    expect(await dataWriteTool.handler({ table: 'jobs', id: 'b', fields: { prompt: 'x' } }, { cwd } as never)).toMatch(/Updated jobs/);
  });
});
