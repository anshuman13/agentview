import { afterEach, describe, expect, test, vi } from 'bun:test';
import { buildHelpers, taskBrief, type BuildUsage } from '../../../shared/build.js';
import type { ChatRun } from '../../../shared/protocol.js';
import { BuildLoop } from './build.js';
import type { AgentSession } from './session.js';

const T0 = new Date('2026-11-28T02:00:00').getTime();
const RESET = T0 + 30 * 60_000;

function fake(reset: number | null) {
  const run = { id: 'r', kind: 'build', state: 'running', why: '', nextAt: null, phase: 'task' } as unknown as ChatRun;
  const s = {
    id: 'c',
    cwd: '/tmp',
    usage: { reset },
    state: { session: { sessionId: 's', running: false } },
    runs: { buildFor: () => (run.state === 'done' ? undefined : run), update: (_: string, p: Partial<ChatRun>) => Object.assign(run, p), end: () => {} },
  };
  return { loop: new BuildLoop(s as unknown as AgentSession), run, s };
}

afterEach(() => vi.useRealTimers());

describe('build at the 5-hour limit', () => {
  test('pauses until a minute after the reset, then resumes', async () => {
    vi.useFakeTimers({ now: T0 });
    const { loop, run, s } = fake(RESET);
    await loop.record('done', true);
    expect(run.state).toBe('paused');
    expect(run.why).toBe('Waiting for the 5-hour reset at 02:30');
    expect(run.nextAt).toBe(RESET + 60_000);
    s.usage.reset = null;
    vi.advanceTimersByTime(30 * 60_000);
    expect(run.state).toBe('paused');
    vi.advanceTimersByTime(60_000);
    expect(run.state).toBe('running');
    expect(run.nextAt).toBeNull();
  });

  test('a restart arms the wait again', () => {
    vi.useFakeTimers({ now: T0 });
    const { loop, run } = fake(null);
    Object.assign(run, { state: 'paused', why: 'Waiting for the 5-hour reset at 02:30', nextAt: RESET + 60_000 });
    loop.kick();
    vi.advanceTimersByTime(31 * 60_000);
    expect(run.state).toBe('running');
  });

  test('a run paused by you is not resumed', () => {
    vi.useFakeTimers({ now: T0 });
    const { loop, run } = fake(null);
    Object.assign(run, { state: 'paused', why: 'Paused by you', nextAt: RESET });
    loop.kick();
    vi.advanceTimersByTime(60 * 60_000);
    expect(run.state).toBe('paused');
  });

  test('a turn without a limit does not wait', async () => {
    const { loop, run } = fake(null);
    await loop.record('done', false);
    expect(run.state).toBe('running');
  });
});

describe('build round usage', () => {
  test('a driver without subagents works alone and ignores the burn samples', () => {
    vi.useFakeTimers({ now: T0 });
    const { loop, run, s } = fake(null);
    Object.assign(s.state.session, { capabilities: { subagents: false }, usage: { fiveHour: { pct: 10, resetsAt: RESET } } });
    const usage = (loop as unknown as { usage(r: ChatRun): BuildUsage }).usage(run);
    expect(usage).toMatchObject({ pct: 10, perAgent: null, solo: true });
    expect(buildHelpers(usage, T0)).toBe(0);
    expect(taskBrief('.claude/specs/x.md', 1, 2, true, usage, T0)).toContain('work alone, without helper agents.');
  });
});
