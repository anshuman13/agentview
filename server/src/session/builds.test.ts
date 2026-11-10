import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BuildEntry } from '../../../shared/builds.js';
import type { AgentEvent, ChatEvent } from '../../../shared/protocol.js';
import { claudeSession } from '../agent/claude/driver.js';
import { buildOne, listBuilds } from './builds.js';

const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'agentview-builds-')));
const repo = path.join(root, 'repo');
const worktree = path.join(root, 'wt');
const store = path.join(root, 'store');
const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
let commit = '';
let tree = '';

beforeAll(() => {
  process.env.AGENTVIEW_BUILDS = store;
  mkdirSync(repo);
  sh(repo, 'init', '-q', '-b', 'main');
  sh(repo, 'config', 'user.email', 't@t');
  sh(repo, 'config', 'user.name', 't');
  writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  sh(repo, 'add', '.');
  sh(repo, 'commit', '-q', '-m', 'init');
  sh(root, 'init', '-q', '--bare', 'origin.git');
  sh(repo, 'remote', 'add', 'origin', path.join(root, 'origin.git'));
  sh(repo, 'push', '-q', 'origin', 'main');
  sh(repo, 'remote', 'set-head', 'origin', 'main');
  sh(repo, 'checkout', '-q', '-b', 'feat/x');
  writeFileSync(path.join(repo, 'feat.txt'), 'f\n');
  sh(repo, 'add', '.');
  sh(repo, 'commit', '-q', '-m', 'Add the kettle');
  commit = sh(repo, 'rev-parse', 'HEAD');
  tree = sh(repo, 'rev-parse', 'HEAD^{tree}');
  sh(repo, 'checkout', '-q', 'main');
  sh(repo, 'worktree', 'add', '-q', worktree, '-b', 'wt-branch');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
const agent = (id: string, description: string, status: AgentEvent['status'] = 'running'): AgentEvent => ({ id: `${id}:agent`, kind: 'agent', toolUseId: id, description, subagentType: 'Build', model: null, background: false, prompt: '', status, startedAt: 1000 + n++, endedAt: status === 'running' ? null : 2000, progress: null, usage: null, at: 1000 });
const result = (id: string, text: string): ChatEvent => ({ id: `${id}:result${n++}`, kind: 'tool_result', toolUseId: id, text, isError: false, at: 2000 });
const stored = (slug: string) => JSON.parse(readFileSync(path.join(store, encodeURIComponent(repo), `${slug}.json`), 'utf8')) as BuildEntry[];

describe('recording builds', () => {
  it('keeps one entry for a running agent that ends, and one for a hand-back emitted twice', async () => {
    const s = claudeSession(repo);
    const a = agent('t1', 'test:red-lamp#1');
    s.pushEvent(a);
    await vi.waitFor(() => expect(stored('red-lamp')).toMatchObject([{ id: 't1', stage: 'test', round: 1, status: 'running', chat: s.id }]));
    Object.assign(a, { status: 'done', endedAt: 2000 });
    s.pushEvent(result('t1', 'Launched'));
    s.emit({ type: 'event', event: result('t1', '1. pass: ok') });
    await vi.waitFor(() => expect(stored('red-lamp')).toMatchObject([{ id: 't1', status: 'done', endedAt: 2000, report: '1. pass: ok' }]));
  });

  it('keeps both of two agents that end together, in the next round when the label has none', async () => {
    const s = claudeSession(repo);
    for (const id of ['p1', 'p2']) {
      const a = agent(id, 'pm:green-door', 'done');
      s.pushEvent(a);
      s.pushEvent(result(id, `spec ${id}`));
    }
    await vi.waitFor(() => expect(stored('green-door').map((e) => [e.id, e.round, e.report])).toEqual([['p1', 1, 'spec p1'], ['p2', 2, 'spec p2']]));
  });

  it('records a chat in a worktree under the main checkout and ignores other agents', async () => {
    const s = claudeSession(worktree);
    s.pushEvent({ ...agent('g1', 'Search the code', 'done'), subagentType: 'general-purpose' });
    s.pushEvent(agent('w1', 'impl:blue-cup', 'done'));
    await vi.waitFor(() => expect(stored('blue-cup')).toHaveLength(1));
    expect(readdirSync(store)).toEqual([encodeURIComponent(repo)]);
  });

  it('stores the first token that is a commit, skipping a tree', async () => {
    const s = claudeSession(repo);
    s.pushEvent(agent('i1', 'impl:red-lamp', 'done'));
    s.pushEvent(result('i1', `tree ${tree} commit ${commit}`));
    await vi.waitFor(() => expect(stored('red-lamp').find((e) => e.id === 'i1')?.commit).toMatchObject({ sha: commit, subject: 'Add the kettle', branch: 'feat/x', files: [{ path: 'feat.txt', additions: 1, deletions: 0 }] }));
    s.pushEvent(agent('i2', 'impl:blue-cup', 'done'));
    s.pushEvent(result('i2', `tree ${tree}`));
    await vi.waitFor(() => expect(stored('blue-cup').find((e) => e.id === 'i2')).toBeTruthy());
    expect(stored('blue-cup').find((e) => e.id === 'i2')?.commit).toBeUndefined();
  });
});

describe('build routes', () => {
  it('reports a build merged once its commit is cherry-picked onto the default branch', async () => {
    expect((await listBuilds(repo)).find((b) => b.slug === 'red-lamp')).toMatchObject({ title: 'red-lamp', state: 'done', conclusion: 'Passed · not merged yet' });
    execFileSync('git', ['cherry-pick', commit], { cwd: repo, env: { ...process.env, GIT_COMMITTER_DATE: new Date(Date.now() + 60_000).toISOString() } });
    expect((await listBuilds(worktree)).find((b) => b.slug === 'red-lamp')?.conclusion).toBe(`Merged as ${commit.slice(0, 7)}`);
  });

  it('gives the slug as the title and no spec when the spec file is missing, and 404 for a bad slug', async () => {
    const one = await buildOne(repo, 'red-lamp');
    expect(one).toMatchObject({ title: 'red-lamp', spec: null, commit: { files: [{ path: 'feat.txt' }] } });
    expect(await buildOne(repo, '../x')).toMatchObject({ status: 404 });
    expect(await buildOne(repo, 'missing')).toMatchObject({ status: 404 });
  });
});
