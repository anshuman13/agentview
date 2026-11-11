import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DeployJob, DeployRecord } from '../../../shared/protocol.js';
import { advanceTimersByTimeAsync } from '../../../testing.js';

const execFileMock = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: (...args: unknown[]) => execFileMock(...args) }),
}));
const { follow, hasDeployApp, parseApp, summarize } = await import('./deploy.js');

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
    const env = summarize('staging:no', 'shop', false, [d(2, 'b', 'success'), d(1, 'a', 'failure')]);
    expect(env.rollbackTo).toBeNull();
  });
});

describe('follow', () => {
  it('rejects when the status payload is not an array', async () => {
    vi.useFakeTimers();
    execFileMock.mockReturnValue(Object.assign(Promise.resolve({ stdout: '{"message":"Not Found"}' }), { child: { stdin: { end() {} } } }));
    const job: DeployJob = { id: 'j', lines: [], done: false, ok: false, url: '' };
    const p = follow('/tmp', 'o/r', 1, job);
    p.catch(() => {});
    await advanceTimersByTimeAsync(5000);
    await expect(p).rejects.toThrow('unexpected deployment status');
    vi.useRealTimers();
  });
});

describe('hasDeployApp', () => {
  it('is true only for a repo with a .deploy/app.yaml', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deploy-'));
    execFileMock.mockImplementation(() => Object.assign(Promise.resolve({ stdout: `${root}\n` }), { child: { stdin: { end() {} } } }));
    expect(await hasDeployApp(root)).toBe(false);
    mkdirSync(path.join(root, '.deploy'));
    writeFileSync(path.join(root, '.deploy', 'app.yaml'), '---\nproject: demo\nenvironments:\n  - name: demo/prod\n');
    expect(await hasDeployApp(root)).toBe(true);
  });
});
