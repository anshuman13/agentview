import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ runs: null as unknown as import('../session/runs.js').Runs }));

vi.mock('./listing.js', async () => {
  const { Runs } = await import('../session/runs.js');
  mocks.runs = new Runs();
  return { runs: mocks.runs, broadcastLive: vi.fn(), learning: { later: vi.fn(), forget: vi.fn() }, seenRunning: () => false, summaryOf: vi.fn() };
});
vi.mock('./watchFiles.js', () => ({ watchFiles: () => ({ close() {} }) }));
vi.mock('../agent/registry.js', async (orig) => {
  const real = await orig<typeof import('../agent/registry.js')>();
  return { ...real, provider: (id: Parameters<typeof real.provider>[0]) => ({ ...real.provider(id), verifyLimits: async () => {} }) };
});

import { ClaudeDriver } from '../agent/claude/driver.js';
import { UNATTENDED_INSTRUCTION } from '../session/prompts.js';
import { createChat, jobChat } from './chats.js';
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
