import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ runs: null as unknown as import('../session/runs.js').Runs }));

vi.mock('./listing.js', async () => {
  const { Runs } = await import('../session/runs.js');
  mocks.runs = new Runs();
  return { runs: mocks.runs, broadcastLive: vi.fn(), learning: { later: vi.fn(), forget: vi.fn() }, seenRunning: () => false, summaryOf: vi.fn() };
});
vi.mock('../agent/claude/pins.js', () => ({ removeChat: vi.fn() }));
vi.mock('./watchFiles.js', () => ({ watchFiles: () => ({ close() {} }) }));
vi.mock('../agent/registry.js', async (orig) => {
  const real = await orig<typeof import('../agent/registry.js')>();
  return { ...real, provider: (id: Parameters<typeof real.provider>[0]) => ({ ...real.provider(id), verifyLimits: async () => {} }) };
});

import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ClaudeDriver } from '../agent/claude/driver.js';
import { removeChat } from '../agent/claude/pins.js';
import { UNATTENDED_INSTRUCTION } from '../session/prompts.js';
import { jobRepo } from '../workspace/testRepo.js';
import { createChat, jobChat, reviewJob } from './chats.js';
import { live } from './state.js';

const unattended = (chat: { driver: unknown }) => (chat.driver as { unattended: boolean }).unattended;

beforeEach(() => {
  vi.spyOn(ClaudeDriver.prototype, 'start').mockImplementation(() => {});
  for (const r of mocks.runs.list().slice()) mocks.runs.end(r.id, 'test');
});

describe('jobChat', () => {
  it('opens an unattended claude chat in the worktree and records a job run', async () => {
    const id = await jobChat({ op: 'job', cwd: '/tmp', title: 'Fix the test', prompt: 'Fix it', jobId: 'j1', branch: 'jobs/fix-1', repo: '/r', paseo: true });
    const run = mocks.runs.list().find((r) => r.state !== 'done')!;
    expect(run).toMatchObject({ kind: 'job', chatId: id, title: 'Fix the test', jobId: 'j1', branch: 'jobs/fix-1', repo: '/r', worktree: '/tmp', paseo: true, provider: 'claude' });
    const chat = live.get(id)!.chat;
    expect(unattended(chat)).toBe(true);
    expect(chat.title).toBe('Fix the test');
    expect(chat.state.events.find((e) => e.kind === 'user')).toMatchObject({ text: `Fix it\n\n${UNATTENDED_INSTRUCTION}` });
  });

  it('a chat reopened on a session with an open job run comes back unattended, one without does not', async () => {
    const id = mocks.runs.start({ kind: 'job', sessionId: 'sess-1', chatId: 'old', title: 't', what: 'w', provider: 'claude' });
    expect(unattended((await createChat('/tmp', 'sess-1')))).toBe(true);
    expect(unattended((await createChat('/tmp', 'sess-2')))).toBe(false);
    mocks.runs.end(id, 'done');
    expect(unattended((await createChat('/tmp', 'sess-1')))).toBe(false);
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
    await reviewJob(chat, id, false);
    expect(run).toMatchObject({ state: 'done', why: 'No changes' });
    expect(removeChat).toHaveBeenCalledWith('s1', false, true);
    expect(live.has(chat.id)).toBe(false);
    expect(existsSync(fx.dir)).toBe(false);
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
