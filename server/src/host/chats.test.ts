import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { waitFor } from '../../../testing.js';
import * as registry from '../agent/registry.js';
import { Runs } from '../session/runs.js';

const mocks = { runs: new Runs() };
const realRegistry = { ...registry };

vi.mock('./listing.js', () => ({ runs: mocks.runs, broadcastLive: vi.fn(), learning: { later: vi.fn(), forget: vi.fn() }, seenRunning: () => false, summaryOf: vi.fn() }));
vi.mock('../agent/claude/pins.js', () => ({ removeChat: vi.fn() }));
const linkSubChat = vi.fn(async () => ({}));
const latest: Record<string, string> = {};
vi.mock('../session/subChats.js', () => ({ linkSubChat, latestOf: async (id: string) => latest[id] ?? id, rootOf: async (id: string) => id }));
vi.mock('./watchFiles.js', () => ({ watchFiles: () => ({ close() {} }) }));
vi.mock('../agent/registry.js', () => {
  const real = realRegistry;
  return { ...real, provider: (id: Parameters<typeof real.provider>[0]) => ({ ...real.provider(id), verifyLimits: async () => {} }) };
});

const { ClaudeDriver } = await import('../agent/claude/driver.js');
const { removeChat } = await import('../agent/claude/pins.js');
const { markLimited } = await import('../agent/claude/accounts.js');
const { UNATTENDED_INSTRUCTION } = await import('../session/prompts.js');
const { jobRepo } = await import('../workspace/testRepo.js');
const { createChat, endRun, jobChat, openSaved, reviewJob } = await import('./chats.js');
const { AgentSession } = await import('../session/session.js');
const { live } = await import('./state.js');

const unattended = (chat: { driver: unknown }) => (chat.driver as { unattended: boolean }).unattended;

beforeEach(() => {
  vi.spyOn(ClaudeDriver.prototype, 'start').mockImplementation(() => {});
  for (const r of mocks.runs.list().slice()) mocks.runs.end(r.id, 'test');
});

describe('openSaved', () => {
  it('opens the live latest sub-chat for any session of its chat', async () => {
    const chat = await createChat('/tmp', 'sub-2');
    latest['root-1'] = 'sub-2';
    expect(await openSaved('root-1')).toBe(chat);
  });
});

describe('jobChat', () => {
  it('opens an unattended claude chat in the worktree and records a job run', async () => {
    const id = await jobChat({ op: 'job', cwd: '/tmp', title: 'Fix the test', prompt: 'Fix it', jobId: 'j1', branch: 'jobs/fix-1', repo: '/r', paseo: true });
    const run = mocks.runs.list().find((r) => r.state !== 'done')!;
    expect(run).toMatchObject({ kind: 'job', chatId: id, title: 'Fix the test', jobId: 'j1', branch: 'jobs/fix-1', repo: '/r', worktree: '/tmp', paseo: true, provider: 'claude' });
    const chat = live.get(id)!.chat;
    expect(unattended(chat)).toBe(true);
    expect(chat.title).toBe('Fix the test');
    await waitFor(() => expect(chat.state.events.find((e) => e.kind === 'user')).toMatchObject({ text: `Fix it\n\n${UNATTENDED_INSTRUCTION}` }));
  });

  it('starts the CLI on the job\'s account and stays on it at the usage limit', async () => {
    const started: string[] = [];
    vi.spyOn(ClaudeDriver.prototype, 'start').mockImplementation(function (this: InstanceType<typeof ClaudeDriver>) { started.push(this.account); });
    const switched = vi.spyOn(ClaudeDriver.prototype, 'setAccount');
    try {
      const picked = live.get(await jobChat({ op: 'job', cwd: '/tmp', title: 'Fix', prompt: 'Fix it', jobId: 'j2', branch: 'jobs/fix-2', repo: '/r', paseo: false, account: 'alt' }))!.chat.driver as InstanceType<typeof ClaudeDriver>;
      expect(started[0]).toBe('alt');
      expect(picked.limitHit(Date.now() + 60_000)).toBeNull();
      expect(picked.account).toBe('alt');
      expect(switched).not.toHaveBeenCalled();
      const auto = live.get(await jobChat({ op: 'job', cwd: '/tmp', title: 'Fix', prompt: 'Fix it', jobId: 'j3', branch: 'jobs/fix-3', repo: '/r', paseo: false }))!.chat.driver as InstanceType<typeof ClaudeDriver>;
      expect((auto as unknown as { pinned: boolean }).pinned).toBe(false);
    } finally {
      switched.mockRestore();
      markLimited('alt', 0);
    }
  });

  it('a chat reopened on a session with an open job run comes back unattended, one without does not', async () => {
    const id = mocks.runs.start({ kind: 'job', sessionId: 'sess-1', chatId: 'old', title: 't', what: 'w', provider: 'claude' });
    const reopened = await createChat('/tmp', 'sess-1');
    expect(unattended(reopened)).toBe(true);
    expect(mocks.runs.get(id)?.chatId).toBe(reopened.id);
    expect(unattended((await createChat('/tmp', 'sess-2')))).toBe(false);
    mocks.runs.end(id, 'done');
    expect(unattended((await createChat('/tmp', 'sess-1')))).toBe(false);
  });
});

describe('createChat', () => {
  it('saves a sub-chat link the chat reports', async () => {
    const chat = await createChat('/tmp');
    chat.onSubChat('b', 'a', 'build');
    expect(linkSubChat).toHaveBeenCalledWith('b', 'a', 'build');
  });
});

describe('reviewJob', () => {
  async function jobRun() {
    const fx = jobRepo();
    const chat = await createChat(fx.dir);
    const { repo, worktree, branch } = fx.run;
    const id = mocks.runs.start({ kind: 'job', sessionId: 's1', chatId: chat.id, title: 't', what: 'w', provider: 'claude', repo, worktree, branch });
    return { fx, chat, id, run: mocks.runs.get(id)! };
  }

  it('closes the chat, removes the worktree and ends an empty run as No changes', async () => {
    const { fx, chat, id, run } = await jobRun();
    for (const id of [...live.keys()]) if (id !== chat.id) live.delete(id);
    await reviewJob(chat, id, false);
    expect(run).toMatchObject({ state: 'done', why: 'No changes' });
    expect(removeChat).toHaveBeenCalledWith('s1', false, true);
    expect(live.has(chat.id)).toBe(false);
    expect([...live.values()].map((l) => l.chat.cwd)).toEqual([fx.repo]);
    expect(existsSync(fx.dir)).toBe(false);
    rmSync(fx.root, { recursive: true, force: true });
  });

  it('ends a run with a PR only while it waits for review', async () => {
    const { fx, id } = await jobRun();
    expect(() => endRun(id, 'PR opened', 'https://example.test/pr/1')).toThrow('not waiting for review');
    mocks.runs.update(id, { review: 'pending' });
    endRun(id, 'PR opened', 'https://example.test/pr/1');
    expect(mocks.runs.get(id)).toMatchObject({ state: 'done', pr: 'https://example.test/pr/1' });
    rmSync(fx.root, { recursive: true, force: true });
  });

  it('keeps the chat of an empty run whose turn failed', async () => {
    const { fx, chat, id, run } = await jobRun();
    await reviewJob(chat, id, true);
    expect(run).toMatchObject({ state: 'done', why: 'Failed' });
    expect([live.has(chat.id), existsSync(fx.dir)]).toEqual([true, true]);
    rmSync(fx.root, { recursive: true, force: true });
  });

  it('pauses a run with a new file for review and flags it as needing you', async () => {
    const { fx, chat, id, run } = await jobRun();
    writeFileSync(path.join(fx.dir, 'new.txt'), 'x\n');
    await reviewJob(chat, id, false);
    expect(run).toMatchObject({ state: 'paused', why: 'Ready for review', review: 'pending', needsYou: true });
    expect(live.has(chat.id)).toBe(true);
    rmSync(fx.root, { recursive: true, force: true });
  });
});
