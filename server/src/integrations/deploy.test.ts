import { describe, expect, it, vi } from 'vitest';
import { follow, parseApp, summarize } from './deploy.js';
import type { DeployJob, DeployRecord } from '../../../shared/protocol.js';

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({
  execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: (...args: unknown[]) => execFileMock(...args) }),
}));

describe('parseApp', () => {
  it('reads the project and environments', () => {
    const text = `---\nproject: precio\nvars:\n  app: precio\nenvironments:\n  - name: precio/staging:no\n    tenant: "no"\n\n  - name: precio/prod:no\n    default_branch_only: true\nsteps:\n  - name: api\n`;
    expect(parseApp(text)).toEqual({
      project: 'precio',
      envs: [
        { name: 'precio/staging:no', defaultBranchOnly: false },
        { name: 'precio/prod:no', defaultBranchOnly: true },
      ],
    });
  });

});

describe('summarize', () => {
  const d = (id: number, sha: string, state: string): DeployRecord => ({ id, sha, ref: '', state, description: '', at: '', by: '', url: '' });

  it('finds the deployed sha and the rollback target', () => {
    const env = summarize('precio/prod:no', 'precio', true, [d(4, 'd', 'failure'), d(3, 'c', 'success'), d(2, 'c', 'inactive'), d(1, 'b', 'inactive')]);
    expect(env.label).toBe('prod:no');
    expect(env.latest?.id).toBe(4);
    expect(env.deployed?.id).toBe(3);
    expect(env.rollbackTo?.sha).toBe('b');
  });

  it('has no rollback without an earlier success', () => {
    const env = summarize('staging:no', 'tienda', false, [d(2, 'b', 'success'), d(1, 'a', 'failure')]);
    expect(env.rollbackTo).toBeNull();
  });
});

describe('follow', () => {
  it('rejects when the status payload is not an array', async () => {
    vi.useFakeTimers();
    execFileMock.mockReturnValue(Object.assign(Promise.resolve({ stdout: '{"message":"Not Found"}' }), { child: { stdin: { end() {} } } }));
    const job: DeployJob = { id: 'j', lines: [], done: false, ok: false, url: '' };
    const settled = expect(follow('/tmp', 'o/r', 1, job)).rejects.toThrow('unexpected deployment status');
    await vi.advanceTimersByTimeAsync(5000);
    await settled;
    vi.useRealTimers();
  });
});
