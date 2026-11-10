import { describe, expect, it, vi } from 'vitest';
import type { AgentSession } from './session.js';
import { prFrom } from './pr.js';
import { busy } from '../host/restore.js';
import { fireTime } from './repeat.js';
import { Runs, WAITING } from './runs.js';
import { claudeSession, type ClaudeDriver } from '../agent/claude/driver.js';
import { historyFrom } from '../agent/claude/transcript.js';
import type { History } from '../agent/types.js';
import { appendTo, BIG_BRO, type ChatEvent, type ServerMessage } from '../../../shared/protocol.js';

function fakeSession() {
  const s = claudeSession('/tmp/project');
  const interrupt = vi.fn(async () => {});
  Object.assign(s.driver, { q: { interrupt } });
  const handle = (msg: unknown) => (s.driver as unknown as { handle: (m: unknown) => void }).handle(msg);
  const result = (uuid: string, subtype = 'success') => handle({ type: 'result', subtype, uuid, result: 'done', total_cost_usd: 0, is_error: subtype !== 'success' });
  return { s, interrupt, result, handle };
}

// The CLI sends its usage-limit notice as an assistant message with error 'rate_limit', then the result.
function limitNotice(handle: (m: unknown) => void, text = "You've hit your session limit · resets 1:50am", error: string | null = 'rate_limit') {
  handle({ type: 'assistant', parent_tool_use_id: null, ...(error && { error }), message: { content: [{ type: 'text', text }], usage: {} } });
  handle({ type: 'result', subtype: 'success', uuid: 'r1', result: text, total_cost_usd: 0, is_error: Boolean(error) });
}

describe('AgentSession turns', () => {

  it('failed stays set after an errored turn ends and clears when the next turn starts', () => {
    const { s, result } = fakeSession();
    s.sendPrompt('go');
    result('r1', 'error_during_execution');
    expect(s.state.session.running).toBe(false);
    expect(s.failed).toBe(true);
    s.sendPrompt('again');
    expect(s.failed).toBe(false);
    result('r2');
    expect(s.failed).toBe(false);
  });

  it('retryLast resends the last user text and rejects when there is nothing to retry', async () => {
    const { s, result } = fakeSession();
    const send = vi.spyOn(s.driver, 'send');
    await expect(s.retryLast()).rejects.toThrow('Nothing to retry');
    s.sendPrompt('go');
    await expect(s.retryLast()).rejects.toThrow('Nothing to retry');
    result('r1', 'error_during_execution');
    send.mockClear();
    await s.retryLast();
    expect(send).toHaveBeenCalledOnce();
    expect(s.state.events.filter((e) => e.kind === 'user').map((e) => e.kind === 'user' && e.text)).toEqual(['go', 'go']);
    result('r2');
    s.pushEvent({ id: 'u2', kind: 'user', text: '/compact', at: 0 });
    send.mockClear();
    await expect(s.retryLast()).rejects.toThrow('Nothing to retry');
    expect(send).not.toHaveBeenCalled();
  });

  it('steer interrupts a running turn and stays running for the steered prompt', async () => {
    const { s, interrupt, result } = fakeSession();
    s.sendPrompt('long task');
    await s.steer('change of plan');
    expect(interrupt).toHaveBeenCalledOnce();
    result('interrupted', 'error_during_execution');
    expect(s.state.session.running).toBe(true);
    result('r2');
    expect(s.state.session.running).toBe(false);
    expect(s.state.events.filter((e) => e.kind === 'user').map((e) => e.kind === 'user' && e.text)).toEqual(['long task', 'change of plan']);
  });

  it('hands a queued message to Claude at the next step, or starts a turn for it', async () => {
    const { s, interrupt, result } = fakeSession();
    const send = vi.spyOn(s.driver, 'send');
    const handle = (m: unknown) => (s.driver as unknown as { handle: (m: unknown) => void }).handle(m);
    s.sendPrompt('long task');
    await s.queueNext('also this', 'q1');
    expect(send).toHaveBeenLastCalledWith('also this', 'q1', 'next');
    expect(interrupt).not.toHaveBeenCalled();
    expect(s.state.events.at(-1)).toMatchObject({ id: 'q1', queued: true });
    s.pushEvent({ id: 't1', kind: 'tool_result', toolUseId: 'x', text: 'ok', isError: false, at: 0 });
    expect(s.state.events.find((e) => e.id === 'q1')).toMatchObject({ queued: false });
    await s.queueNext('late one', 'q2');
    result('r1');
    expect(s.state.events.find((e) => e.id === 'q2')).toMatchObject({ queued: false });
    expect(s.state.session.running).toBe(false);
    const before = s.state.events.length;
    handle({ type: 'system', subtype: 'session_state_changed', state: 'running' });
    expect(s.state.session.running).toBe(true);
    expect(s.state.events.slice(before).some((e) => e.kind === 'system')).toBe(false);
    result('r2');
    expect(s.state.session.running).toBe(false);
  });

  it('Stop cancels queued messages Claude has not read, Send now keeps them', async () => {
    const { s, interrupt } = fakeSession();
    s.sendPrompt('long task');
    await s.queueNext('go now', 'q1');
    await s.sendNow('q1');
    expect(interrupt).toHaveBeenLastCalledWith({ cancelQueued: false });
    expect(s.state.events.some((e) => e.id === 'q1')).toBe(true);
    const { s: s2, interrupt: i2 } = fakeSession();
    s2.sendPrompt('long task');
    (s2.driver as unknown as { input: { clear(): void } }).input.clear();
    await s2.queueNext('never mind', 'q2');
    await s2.interrupt();
    expect(i2).toHaveBeenLastCalledWith({ cancelQueued: true });
    expect(s2.state.events.some((e) => e.id === 'q2')).toBe(false);
  });

  it('stops the loop and the running state when a step cannot switch model', async () => {
    const { s } = fakeSession();
    Object.assign(s.driver, { q: { interrupt: vi.fn(), setModel: vi.fn(async () => { throw new Error('no such model'); }), applyFlagSettings: vi.fn(async () => {}), setPermissionMode: vi.fn(async () => {}) } });
    s.setLoop(true);
    await s.prompt('build it');
    expect(s.state.session.running).toBe(false);
    expect(s.state.session.loop.phase).toBe('failed');
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: expect.stringContaining('Build cycle stopped') });
  });

  it('stops the loop when Claude exits mid-step', async () => {
    const { s } = fakeSession();
    const setModel = vi.fn(async () => {});
    Object.assign(s.driver, { q: { interrupt: vi.fn(), setModel, applyFlagSettings: vi.fn(async () => {}), setPermissionMode: vi.fn(async () => {}) } });
    s.state.session.model = 'claude-sonnet-5-5';
    s.setLoop(true);
    await s.prompt('build it');
    s.exited();
    expect(s.state.session.loop.phase).toBe('failed');
    expect(setModel).toHaveBeenLastCalledWith('claude-sonnet-5-5');
  });

  it('asks for a loop plan only when the planner says it needs approval', async () => {
    const { s, result } = fakeSession();
    Object.assign(s.driver, { q: { interrupt: vi.fn(), setModel: vi.fn(async () => {}), applyFlagSettings: vi.fn(async () => {}), setPermissionMode: vi.fn(async () => {}) } });
    s.setLoop(true);
    await s.prompt('build it');
    await expect(s.canUseTool('ExitPlanMode', { plan: 'Edit a.ts\nAPPROVAL: NOT NEEDED' }, { signal: new AbortController().signal })).resolves.toMatchObject({ behavior: 'allow' });
    const asked = s.canUseTool('ExitPlanMode', { plan: 'Drop the users table\nAPPROVAL: NEEDED, deletes data' }, { signal: new AbortController().signal });
    expect(s.state.pending).toHaveLength(1);
    s.answerPermission(s.state.pending[0].id, false);
    await expect(asked).resolves.toMatchObject({ behavior: 'deny' });
    result('r1');
    expect(s.state.session.loop.phase).toBe('failed');
    expect(s.state.events.some((e) => e.kind === 'system' && e.text === 'Build cycle stopped: the plan was not approved')).toBe(true);
  });

  it('takes the plan approval from the reply when the plan step ends without ExitPlanMode', async () => {
    const { s, handle } = fakeSession();
    Object.assign(s.driver, { q: { interrupt: vi.fn(), setModel: vi.fn(async () => {}), applyFlagSettings: vi.fn(async () => {}), setPermissionMode: vi.fn(async () => {}) } });
    s.setLoop(true);
    await s.prompt('build it');
    const reply = (uuid: string, text: string) => handle({ type: 'result', subtype: 'success', uuid, result: text, total_cost_usd: 0, is_error: false });
    reply('r1', 'Drop the users table\nAPPROVAL: NEEDED, deletes data');
    expect(s.state.pending).toHaveLength(1);
    s.answerPermission(s.state.pending[0].id, false);
    await new Promise((r) => setTimeout(r));
    expect(s.state.session.loop.phase).toBe('failed');

    const next = fakeSession();
    Object.assign(next.s.driver, { q: { interrupt: vi.fn(), setModel: vi.fn(async () => {}), applyFlagSettings: vi.fn(async () => {}), setPermissionMode: vi.fn(async () => {}) } });
    next.s.setLoop(true);
    await next.s.prompt('build it');
    next.handle({ type: 'result', subtype: 'success', uuid: 'r2', result: 'Edit a.ts\nAPPROVAL: NOT NEEDED', total_cost_usd: 0, is_error: false });
    expect(next.s.state.pending).toHaveLength(0);
    expect(next.s.state.session.loop.phase).toBe('build');
  });

  it('runs the build cycle on the driver\'s role models', () => {
    const { s } = fakeSession();
    expect(s.driver.roleModel('test')).toEqual({ model: 'claude-sonnet-5-5' });
    Object.assign(s.driver, { openrouter: true });
    expect(s.driver.roleModel('plan')).toEqual({ model: 'openrouter:opus' });
    expect(s.driver.roleModel('test')).toEqual({ model: 'openrouter:sonnet' });
  });

  it('switches the build cycle off when it passes, so the next message is a normal turn', async () => {
    const { s, handle } = fakeSession();
    s.setLoop(true);
    s.state.session.loop = { on: true, max: 3, round: 1, phase: 'test' };
    s.sendPrompt('test it');
    handle({ type: 'result', subtype: 'success', uuid: 'r1', result: 'VERDICT: PASS', total_cost_usd: 0, is_error: false });
    expect(s.state.session.loop).toMatchObject({ on: false, phase: 'passed' });
    const send = vi.spyOn(s, 'sendPrompt');
    await s.prompt('next');
    expect(send).toHaveBeenCalledWith('next', expect.any(String));
    expect(s.state.session.loop.phase).toBe('passed');
  });

  it('does not resume a build cycle that a restart interrupted', () => {
    const { s } = fakeSession();
    s.restoreLoop({ on: true, max: 5, round: 2, phase: 'build' });
    expect(s.state.session.loop).toEqual({ on: false, max: 5, round: 0, phase: null });
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: 'Build cycle interrupted by a restart. Send a message to start it again.' });
    s.restoreLoop({ on: true, max: 4, round: 0, phase: null });
    expect(s.state.session.loop.on).toBe(true);
  });

  it('continues on the other account when a turn ends on a usage limit', async () => {
    const { s, handle } = fakeSession();
    const limitHit = vi.fn(() => 'alt' as const);
    Object.assign(s.driver, { limitHit, accounts: () => ['main', 'alt'] });
    s.sendPrompt('long task');
    limitNotice(handle);
    expect(limitHit).toHaveBeenCalledOnce();
    expect(s.state.session).toMatchObject({ account: 'alt', running: true });
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'user', text: expect.stringContaining('Continue where you stopped') });
  });

  it('stops a turn that starts on extra usage and goes on under the other account', async () => {
    const { s, handle } = fakeSession();
    const limitHit = vi.fn(() => 'alt' as const);
    const interrupt = vi.fn(async () => {});
    Object.assign(s.driver, { limitHit, interrupt, accounts: () => ['main', 'alt'] });
    s.sendPrompt('long task');
    handle({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', isUsingOverage: false } });
    expect(interrupt).not.toHaveBeenCalled();
    handle({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', isUsingOverage: true, resetsAt: 1_900_000_000 } });
    expect(interrupt).toHaveBeenCalledOnce();
    handle({ type: 'result', subtype: 'error_during_execution', uuid: 'r1', errors: [], total_cost_usd: 0, is_error: true });
    expect(limitHit).toHaveBeenCalledWith(1_900_000_000_000);
    expect(s.state.session).toMatchObject({ account: 'alt', running: true });
  });

  it('leaves the restarted Claude alone after extra usage while idle', () => {
    const { s, handle, interrupt } = fakeSession();
    const d = s.driver as unknown as ClaudeDriver;
    const fresh = vi.fn(async () => {});
    Object.assign(d, {
      q: { interrupt, close: vi.fn() },
      start: vi.fn(() => Object.assign(d, { q: { interrupt: fresh } })),
      accounts: () => ['main', 'alt'],
      limitHit: () => (d.setAccount('alt'), 'alt'),
    });
    s.crons = [{ schedule: '*/5 * * * *', prompt: 'check the build', recurring: true }];
    handle({ type: 'rate_limit_event', rate_limit_info: { isUsingOverage: true, resetsAt: 1_900_000_000 } });
    expect(fresh).not.toHaveBeenCalled();
    expect(s.state.session).toMatchObject({ account: 'alt', running: true });
  });

  it('takes no usage limit from a normal reply that mentions one', async () => {
    const { s, handle } = fakeSession();
    const limitHit = vi.fn(() => 'alt' as const);
    Object.assign(s.driver, { limitHit, accounts: () => ['main', 'alt'] });
    s.sendPrompt('check the API');
    limitNotice(handle, 'Your GitHub API rate limit resets at 14:30.', null);
    expect(limitHit).not.toHaveBeenCalled();
    expect(s.state.session).toMatchObject({ account: 'main', running: false });
  });

  it('waits for the reset when no other account has usage left', async () => {
    const { s, handle } = fakeSession();
    Object.assign(s.driver, { limitHit: vi.fn(() => null) });
    s.sendPrompt('long task');
    limitNotice(handle);
    expect(s.state.session).toMatchObject({ account: 'main', running: false });
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: expect.stringContaining('Usage limit reached') });
  });

  it('switches account only when idle and logged in', () => {
    const { s } = fakeSession();
    const setAccount = vi.fn();
    Object.assign(s.driver, { setAccount, accounts: () => ['main'] });
    s.setAccount('alt');
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: expect.stringContaining('That Claude account is not logged in') });
    Object.assign(s.driver, { accounts: () => ['main', 'alt'] });
    s.sendPrompt('work');
    s.setAccount('alt');
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: 'Stop Claude before switching account' });
    expect(setAccount).not.toHaveBeenCalled();
  });

  it('recreates scheduled jobs and stops agents after an account switch restarts Claude', () => {
    const { s } = fakeSession();
    const send = vi.spyOn(s.driver, 'send');
    Object.assign(s.driver, { q: { close: vi.fn() }, start: vi.fn(), accounts: () => ['main', 'alt'] });
    s.crons = [{ schedule: '*/5 * * * *', prompt: 'check the build', recurring: true }];
    s.pushEvent({ id: 'a1', kind: 'agent', toolUseId: 'tu1', status: 'running', background: true, description: '', prompt: 'p', at: 0 } as ChatEvent);
    s.setAccount('alt');
    expect(s.agentOf('tu1')?.status).toBe('stopped');
    expect(send).toHaveBeenCalledWith(expect.stringMatching(/^Claude restarted on another account\..*check the build/s), expect.any(String));
    expect(s.state.session.running).toBe(true);
  });

  it('queues a steer while compacting', async () => {
    const { s, interrupt } = fakeSession();
    s.sendPrompt('/compact');
    await s.steer('after compact');
    expect(interrupt).not.toHaveBeenCalled();
    expect(s.state.events.at(-1)).toMatchObject({ text: 'after compact', queued: true });
  });

  it('steer shows the message before the interrupt finishes', async () => {
    const { s, interrupt } = fakeSession();
    let finish = () => {};
    interrupt.mockImplementationOnce(() => new Promise<void>((r) => (finish = r)));
    s.sendPrompt('long task');
    const done = s.steer('change of plan', 'm1');
    expect(s.state.events.at(-1)).toMatchObject({ id: 'm1', kind: 'user', stopping: true });
    finish();
    await done;
    expect(s.state.events.find((e) => e.id === 'm1')).toMatchObject({ stopping: false });
  });

  it('does not auto-compact after a stop', async () => {
    const { s, result } = fakeSession();
    s.sendPrompt('big task');
    (s.driver as unknown as { input: { clear(): void } }).input.clear();
    s.state.session.context = 210_000;
    await s.interrupt();
    result('r1', 'error_during_execution');
    expect(s.state.session.running).toBe(false);
    expect(s.state.events.filter((e) => e.kind === 'user').at(-1)).toMatchObject({ text: 'big task' });
  });

  it('never counts below zero turns', () => {
    const { s, result } = fakeSession();
    result('stray');
    s.sendPrompt('hi');
    expect(s.state.session.running).toBe(true);
  });

  it('queues a prompt that arrives while the previous one is still starting', async () => {
    const { s } = fakeSession();
    const send = vi.spyOn(s.driver, 'send');
    await Promise.all([s.prompt('one', 'p1'), s.prompt('two', 'p2')]);
    expect(send).toHaveBeenCalledOnce();
    expect(s.state.events.find((e) => e.id === 'p2')).toMatchObject({ queued: true });
  });

  it('sends prompts queued during a turn one per turn, in the order typed', async () => {
    const { s, result } = fakeSession();
    const sent = () => s.state.events.filter((e) => e.kind === 'user' && !e.queued).map((e) => e.kind === 'user' && e.text);
    const waiting = () => s.state.events.filter((e) => e.kind === 'user' && e.queued).map((e) => e.kind === 'user' && e.text);
    s.sendPrompt('task');
    await s.prompt('A');
    await s.prompt('B');
    await s.prompt('C');
    expect(sent()).toEqual(['task']);
    expect(waiting()).toEqual(['A', 'B', 'C']);
    result('r1');
    expect(sent()).toEqual(['task', 'A']);
    expect(waiting()).toEqual(['B', 'C']);
    result('r2');
    result('r3');
    expect(sent()).toEqual(['task', 'A', 'B', 'C']);
    expect(waiting()).toEqual([]);
    expect(s.state.session.running).toBe(true);
    result('r4');
    expect(s.state.session.running).toBe(false);
  });

  it('a plan change made during a turn goes out before a queued prompt', async () => {
    const { s, result } = fakeSession();
    const sent = () => s.state.events.filter((e) => e.kind === 'user' && !e.queued).map((e) => e.kind === 'user' && e.text);
    const waiting = () => s.state.events.filter((e) => e.kind === 'user' && e.queued).map((e) => e.kind === 'user' && e.text);
    s.sendPrompt('task');
    await s.prompt('next');
    s.changePlan(['a']);
    result('r1');
    expect(sent()).toEqual(['task', expect.stringContaining('1. a')]);
    expect(waiting()).toEqual(['next']);
    result('r2');
    expect(sent()).toEqual(['task', expect.stringContaining('1. a'), 'next']);
    expect(waiting()).toEqual([]);
  });

  it('interrupt drops the queued prompts with a single init', async () => {
    const { s, interrupt, result } = fakeSession();
    const sent: ServerMessage[] = [];
    s.onMessage((m) => sent.push(m));
    s.sendPrompt('task');
    await s.prompt('A');
    await s.prompt('B');
    (s.driver as unknown as { input: { clear(): void } }).input.clear();
    await s.interrupt();
    expect(interrupt).toHaveBeenCalledOnce();
    expect(s.state.events.filter((e) => e.kind === 'user').map((e) => e.kind === 'user' && e.text)).toEqual(['task']);
    expect(sent.filter((m) => m.type === 'init')).toHaveLength(1);
    result('r1', 'error_during_execution');
    expect(s.state.session.running).toBe(false);
    expect(sent.filter((m) => m.type === 'init')).toHaveLength(1);
  });
});

describe('Fable approval', () => {
  const call = (s: AgentSession, subagent_type: string) =>
    (s.driver as unknown as { toolHooks: { beforeAgent: (i: unknown, sig: AbortSignal) => Promise<any> } }).toolHooks.beforeAgent(
      { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type, description: 'race condition', prompt: 'why?' }, tool_use_id: 't1' },
      new AbortController().signal,
    );

  it('waits for the user and allows when approved', async () => {
    const s = claudeSession('/tmp/p');
    const decision = call(s, BIG_BRO);
    const req = s.state.pending[0];
    expect(req).toMatchObject({ kind: 'permission', title: 'Ask Fable: race condition', canAlwaysAllow: false });
    s.answerPermission(req.id, true);
    expect((await decision).hookSpecificOutput.permissionDecision).toBe('allow');
  });

  it('a steer denies a pending permission and goes on with the message', async () => {
    const { s, interrupt } = fakeSession();
    s.sendPrompt('work');
    const decision = call(s, BIG_BRO);
    expect(s.state.pending).toHaveLength(1);
    await s.steer('do this instead');
    expect(s.state.pending).toHaveLength(0);
    expect((await decision).hookSpecificOutput).toMatchObject({ permissionDecision: 'deny' });
    expect(interrupt).toHaveBeenCalled();
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'user', text: 'do this instead', stopping: false });
  });

});

describe('Team mode', () => {
  function teamSession() {
    const s = claudeSession('/tmp/p');
    const q = { interrupt: vi.fn(async () => {}), setModel: vi.fn(async () => {}), setPermissionMode: vi.fn(async () => {}), applyFlagSettings: vi.fn(async () => {}) };
    Object.assign(s.driver, { q });
    return { s, q };
  }

  it('uses opusplan with an Opus advisor, and clears the advisor when leaving', async () => {
    const { s, q } = teamSession();
    await s.setModel('team');
    expect(q.applyFlagSettings).toHaveBeenLastCalledWith({ advisorModel: 'claude-opus-5-5' });
    expect(q.setModel).toHaveBeenLastCalledWith('opusplan');
    expect(s.state.session.team).toBe(true);
    await s.setModel('claude-opus-5-5');
    expect(q.applyFlagSettings).toHaveBeenLastCalledWith({ advisorModel: null });
    expect(s.state.session.team).toBe(false);
  });

  it('starts every new task in plan mode', async () => {
    const { s, q } = teamSession();
    await s.setModel('team');
    await s.prompt('add a feature');
    expect(q.setPermissionMode).toHaveBeenCalledWith('plan');
    expect(s.state.session.permissionMode).toBe('plan');
  });

  it('queues the message with a notice when plan mode fails', async () => {
    const { s, q } = teamSession();
    await s.setModel('team');
    q.setPermissionMode.mockRejectedValueOnce(new Error('CLI gone'));
    await s.prompt('add a feature', 'm1');
    expect(s.queuedMessages).toEqual([{ id: 'm1', text: 'add a feature' }]);
    expect(s.state.events.some((e) => e.kind === 'system' && e.text.includes('CLI gone'))).toBe(true);
  });

  it('does not force plan mode outside Team mode or mid-turn', async () => {
    const { s, q } = teamSession();
    await s.prompt('hi');
    expect(q.setPermissionMode).not.toHaveBeenCalled();
    await s.setModel('team');
    await s.prompt('queued while running');
    expect(q.setPermissionMode).not.toHaveBeenCalled();
  });
});

describe('changed files', () => {
  const run = (isError: boolean) => {
    const s = claudeSession('/repo');
    const handle = (m: unknown) => (s.driver as unknown as { handle: (m: unknown) => void }).handle(m);
    handle({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'e1', name: 'Write', input: { file_path: '/repo/README.md' } }] } });
    handle({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'e1', content: isError ? 'denied' : 'ok', is_error: isError }] } });
    return s.state.recentFiles;
  };

  it('marks a file only after the edit succeeds', () => {
    expect(run(false)).toEqual(['README.md']);
    expect(run(true)).toEqual([]);
  });
});

describe('plan changes', () => {
  const hook = { hook_event_name: 'PostToolUse', session_id: 's', transcript_path: '', cwd: '', tool_name: 'Bash', tool_input: {}, tool_response: '', tool_use_id: 't' } as never;

  it('delivers a plan change at the next tool call without interrupting', () => {
    const { s, interrupt } = fakeSession();
    s.sendPrompt('task');
    s.changePlan(['curl /check', 'stop the server']);
    expect(interrupt).not.toHaveBeenCalled();
    s.pushEvent({ id: 't1', kind: 'tool_use', name: 'Bash', input: {}, at: 0 });
    const out = (s.driver as ClaudeDriver).toolHooks.afterTool(hook) as { hookSpecificOutput?: { additionalContext?: string } };
    expect(out.hookSpecificOutput?.additionalContext).toContain('1. curl /check\n2. stop the server');
    expect((s.driver as ClaudeDriver).toolHooks.afterTool(hook)).toEqual({});
  });

  it('skips sub-agent tool calls', () => {
    const { s } = fakeSession();
    s.sendPrompt('task');
    s.changePlan(['a']);
    s.pushEvent({ id: 't1', kind: 'tool_use', name: 'Bash', input: {}, at: 0 });
    expect((s.driver as ClaudeDriver).toolHooks.afterTool({ ...(hook as object), agent_id: 'sub' } as never)).toEqual({});
    expect((s.driver as ClaudeDriver).toolHooks.afterTool(hook)).toMatchObject({ hookSpecificOutput: { additionalContext: expect.stringContaining('1. a') } });
  });

  it('sends a plan change as a prompt when the agent cannot take it mid-turn', async () => {
    const { s } = fakeSession();
    s.sendPrompt('task');
    s.changePlan(['a']);
    vi.spyOn(s.driver, 'inject').mockResolvedValue(false);
    s.pushEvent({ id: 't1', kind: 'tool_use', name: 'Bash', input: {}, at: 0 });
    await Promise.resolve();
    expect(s.state.events.filter((e) => e.kind === 'user').at(-1)).toMatchObject({ text: expect.stringContaining('1. a') });
  });

  it('sends an undelivered plan change as a prompt when the turn ends', () => {
    const { s, result } = fakeSession();
    s.sendPrompt('task');
    s.changePlan(['a']);
    result('r1');
    expect(s.state.session.running).toBe(true);
    expect(s.state.events.filter((e) => e.kind === 'user').at(-1)).toMatchObject({ text: expect.stringContaining('1. a') });
  });

  it('reminds Claude to report progress after 8 tool calls without set_status', () => {
    const { s } = fakeSession();
    const text = () => ((s.driver as ClaudeDriver).toolHooks.afterTool(hook) as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput?.additionalContext;
    for (let i = 0; i < 7; i++) expect(text()).toBeUndefined();
    expect(text()).toContain('set_status');
    (s.driver as ClaudeDriver).toolHooks.afterTool({ ...(hook as object), tool_name: 'mcp__agentview__set_status' } as never);
    for (let i = 0; i < 7; i++) expect(text()).toBeUndefined();
  });

});

describe('subagents', () => {
  const launched = 'Async agent launched successfully.\nagentId: a1';

  it('keeps a background agent running until its notification and tags its steps', () => {
    const { s, handle } = fakeSession();
    s.sendPrompt('survey');
    handle({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'ag', name: 'Agent', input: { description: 'Survey' } }] } });
    handle({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'ag', content: launched }] } });
    handle({ type: 'assistant', parent_tool_use_id: 'ag', message: { content: [{ type: 'tool_use', id: 'g1', name: 'Grep', input: { pattern: 'x' } }] } });
    handle({ type: 'user', parent_tool_use_id: 'ag', message: { content: [{ type: 'tool_result', tool_use_id: 'g1', content: 'hit' }] } });
    expect(s.state.events.filter((e) => e.kind === 'tool_result' && e.toolUseId === 'ag')).toEqual([]);
    expect(s.state.events.filter((e) => 'parent' in e && e.parent === 'ag').map((e) => e.kind)).toEqual(['tool_use', 'tool_result']);
    handle({ type: 'system', subtype: 'task_notification', tool_use_id: 'ag', status: 'completed', summary: 'Found 3 docs', output_file: '' });
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'tool_result', toolUseId: 'ag', text: 'Found 3 docs', isError: false });
  });

  it('keeps the full agent report and caps other tool results', () => {
    const { s, handle } = fakeSession();
    const long = 'x'.repeat(6000);
    handle({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'ag', name: 'Agent', input: { description: 'Survey' } }, { type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'ls' } }] } });
    handle({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'ag', content: `${long}\nagentId: a1 (use SendMessage with to: 'a1')\n<usage>total_tokens: 5\ntool_uses: 1\nduration_ms: 9</usage>` }, { type: 'tool_result', tool_use_id: 'b1', content: long }] } });
    const text = (id: string) => (s.state.events.find((e) => e.kind === 'tool_result' && e.toolUseId === id) as { text: string }).text;
    expect(text('ag')).toBe(long);
    expect(text('b1')).toHaveLength(4000);
    handle({ type: 'system', subtype: 'task_notification', tool_use_id: 'ag', task_id: 'a1', status: 'completed', summary: 'Agent "Survey" completed', output_file: '' });
    expect(s.state.events.filter((e) => e.kind === 'tool_result' && e.toolUseId === 'ag')).toHaveLength(1);
  });

  it('tracks an agent from start to notification', () => {
    const { s, handle } = fakeSession();
    const agent = () => s.state.events.find((e) => e.kind === 'agent');
    handle({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'ag', name: 'Agent', input: { description: 'Survey', subagent_type: 'Explore', prompt: 'Find docs' } }] } });
    expect(agent()).toMatchObject({ id: 'ag:agent', toolUseId: 'ag', description: 'Survey', subagentType: 'Explore', prompt: 'Find docs', status: 'running' });
    handle({ type: 'system', subtype: 'task_started', task_id: 'a1', tool_use_id: 'ag', description: 'Survey', is_backgrounded: true });
    handle({ type: 'assistant', parent_tool_use_id: 'ag', message: { model: 'claude-sonnet-5-5', content: [] } });
    handle({ type: 'system', subtype: 'task_progress', task_id: 'a1', tool_use_id: 'ag', description: 'Survey', summary: 'Reading docs', usage: { total_tokens: 100, tool_uses: 2, duration_ms: 3000 } });
    expect(agent()).toMatchObject({ background: true, model: 'claude-sonnet-5-5', progress: 'Reading docs', usage: { tokens: 100, toolUses: 2, durationMs: 3000 } });
    handle({ type: 'system', subtype: 'task_notification', task_id: 'a1', tool_use_id: 'ag', status: 'completed', summary: 'done', output_file: '', usage: { total_tokens: 200, tool_uses: 4, duration_ms: 9000 } });
    expect(agent()).toMatchObject({ status: 'done', usage: { tokens: 200, toolUses: 4 } });
    expect((agent() as { endedAt: number }).endedAt).toBeGreaterThan(0);
  });

  it('stops an agent whose task is gone instead of leaving it running', async () => {
    const msg = (type: string, content: unknown) => ({ type, uuid: 'u1', session_id: 's', parent_tool_use_id: null, timestamp: '2026-10-15T10:00:00Z', message: { content } }) as never;
    const history = [
      msg('user', 'survey'),
      msg('assistant', [{ type: 'tool_use', id: 'ag', name: 'Agent', input: { description: 'Survey', run_in_background: true } }]),
      msg('user', [{ type: 'tool_result', tool_use_id: 'ag', content: launched }]),
    ];
    const s = claudeSession('/tmp/project');
    const apply = () => s.replaceHistory((s.driver as unknown as { history: (m: unknown[], subs: object) => History }).history(history, {}));
    apply();
    const agent = () => s.state.events.find((e) => e.kind === 'agent');
    expect(agent()).toMatchObject({ status: 'running' });
    await s.stopTask('ag');
    expect(agent()).toMatchObject({ status: 'stopped' });
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'tool_result', toolUseId: 'ag', stopped: true });
    apply();
    expect(agent()).toMatchObject({ status: 'stopped' });
  });

  it('resolves a notification that only carries the task id', () => {
    const { s, handle } = fakeSession();
    handle({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'ag', name: 'Agent', input: { description: 'Survey' } }] } });
    handle({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'ag', content: launched }] } });
    handle({ type: 'system', subtype: 'task_notification', task_id: 'a1', status: 'failed', summary: 'Boom', output_file: '' });
    expect(s.state.events.find((e) => e.kind === 'agent')).toMatchObject({ status: 'failed' });
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'tool_result', toolUseId: 'ag', isError: true });
  });

  it('rebuilds the agent from history', () => {
    const msg = (type: string, content: unknown, ts = '2026-10-15T10:00:00Z', extra = {}) => ({ type, uuid: 'u', session_id: 's', parent_tool_use_id: null, timestamp: ts, message: { content, ...extra } }) as never;
    const { events } = historyFrom(
      [
        msg('user', 'survey'),
        msg('assistant', [{ type: 'tool_use', id: 'ag', name: 'Agent', input: { description: 'Survey', prompt: 'Find docs' } }]),
        msg('user', [{ type: 'tool_result', tool_use_id: 'ag', content: 'Report\nagentId: a1 (use SendMessage)\n<usage>total_tokens: 50\ntool_uses: 3\nduration_ms: 60000</usage>' }], '2026-10-15T10:01:00Z'),
      ],
      { ag: [msg('assistant', [{ type: 'text', text: 'Report' }], '2026-10-15T10:00:30Z', { model: 'claude-opus-5-5' })] },
    );
    const i = events.findIndex((e) => e.id === 'ag');
    expect(events[i + 1]).toMatchObject({ kind: 'agent', toolUseId: 'ag', prompt: 'Find docs', model: 'claude-opus-5-5', status: 'done', endedAt: Date.parse('2026-10-15T10:01:00Z'), usage: { tokens: 50, toolUses: 3, durationMs: 60000 } });
  });

  it('marks a resumed background agent done when its hand-back arrives', () => {
    const msg = (type: string, content: unknown, ts: string) => ({ type, uuid: 'u', session_id: 's', parent_tool_use_id: null, timestamp: ts, message: { content } }) as never;
    const { events } = historyFrom([
      msg('user', 'survey', '2026-10-15T10:00:00Z'),
      msg('assistant', [{ type: 'tool_use', id: 'ag', name: 'Agent', input: { description: 'Survey', prompt: 'Find docs', run_in_background: true } }], '2026-10-15T10:00:01Z'),
      msg('user', [{ type: 'tool_result', tool_use_id: 'ag', content: 'Async agent launched successfully.\nagentId: a1 (use SendMessage)' }], '2026-10-15T10:00:02Z'),
      msg('user', '<task-notification>\n<task-id>a1</task-id>\n<status>stopped</status>\n<summary>cut off</summary>\n</task-notification>', '2026-10-15T10:01:00Z'),
      msg('assistant', [{ type: 'tool_use', id: 'sm', name: 'SendMessage', input: { to: 'a1', message: 'continue' } }], '2026-10-15T10:02:00Z'),
      msg('user', [{ type: 'tool_result', tool_use_id: 'sm', content: 'Resuming agent a1' }], '2026-10-15T10:02:01Z'),
      msg('user', '<task-notification>\n<task-id>a1</task-id>\n<tool-use-id>sm</tool-use-id>\n<status>completed</status>\n<result>Report</result>\n</task-notification>', '2026-10-15T10:05:00Z'),
    ]);
    expect(events.find((e) => e.kind === 'agent')).toMatchObject({ toolUseId: 'ag', status: 'done', endedAt: Date.parse('2026-10-15T10:05:00Z') });
  });

  it('shows a peer hand-back as the agent report and ignores the stopped notice after a restart', () => {
    const msg = (type: string, content: unknown, ts: string) => ({ type, uuid: 'u', session_id: 's', parent_tool_use_id: null, timestamp: ts, message: { content } }) as never;
    const { events } = historyFrom([
      msg('user', 'survey', '2026-10-15T10:00:00Z'),
      msg('assistant', [{ type: 'tool_use', id: 'ag', name: 'Agent', input: { description: 'Survey', prompt: 'Find docs', run_in_background: true } }], '2026-10-15T10:00:01Z'),
      msg('user', [{ type: 'tool_result', tool_use_id: 'ag', content: 'Async agent launched successfully.\nagentId: a1 (use SendMessage)' }], '2026-10-15T10:00:02Z'),
      msg('user', 'Another Claude session sent a message:\n<agent-message from="a1">\n[Subagent hand-back] The report follows:\n  Found 3 docs\n  \n  Done\n</agent-message>\n\nThat "other Claude session" is a subagent.', '2026-10-15T10:01:00Z'),
      msg('user', '<task-notification>\n<task-id>a1</task-id>\n<status>stopped</status>\n<summary>did not finish</summary>\n</task-notification>', '2026-10-15T10:02:00Z'),
    ]);
    expect(events.filter((e) => e.kind === 'user')).toHaveLength(1);
    expect(events.find((e) => e.kind === 'tool_result' && e.toolUseId === 'ag')).toMatchObject({ text: 'Found 3 docs\n\nDone' });
    expect(events.find((e) => e.kind === 'agent')).toMatchObject({ status: 'done', endedAt: Date.parse('2026-10-15T10:01:00Z') });
  });

  it('uses the hand-back report', () => {
    const { s, handle } = fakeSession();
    handle({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'ag', name: 'Agent', input: { description: 'Survey' } }] } });
    handle({ type: 'user', parent_tool_use_id: null, tool_use_result: { status: 'completed', handbackReport: { text: 'Full report' }, content: [] }, message: { content: [{ type: 'tool_result', tool_use_id: 'ag', content: 'This agent\'s report was delivered to you as a message' }] } });
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'tool_result', text: 'Full report' });
  });

  it('rebuilds a long or handed-back report from history', () => {
    const msg = (type: string, content: unknown) => ({ type, uuid: 'u', session_id: 's', parent_tool_use_id: null, timestamp: '2026-10-15T10:00:00Z', message: { content } }) as never;
    const long = 'y'.repeat(6000);
    const { events } = historyFrom(
      [
        msg('user', 'survey'),
        msg('assistant', [{ type: 'tool_use', id: 'ag', name: 'Agent', input: { description: 'Survey' } }, { type: 'tool_use', id: 'fg', name: 'Agent', input: { description: 'Check' } }]),
        msg('user', [{ type: 'tool_result', tool_use_id: 'ag', content: launched }, { type: 'tool_result', tool_use_id: 'fg', content: 'delivered as a message\nagentId: a2 (use SendMessage)\n<usage>total_tokens: 5\ntool_uses: 1\nduration_ms: 9</usage>' }]),
        msg('user', `<task-notification>\n<tool-use-id>ag</tool-use-id>\n<status>completed</status>\n<result>${long}</result>\n</task-notification>`),
      ],
      { fg: [msg('assistant', [{ type: 'tool_use', id: 'h1', name: 'SubagentHandback', input: { message: 'Handed back' } }])] },
    );
    const report = (id: string) => events.find((e) => e.kind === 'tool_result' && e.toolUseId === id && !e.parent);
    expect(report('ag')).toMatchObject({ text: long });
    expect(report('fg')).toMatchObject({ text: 'Handed back' });
  });
});

describe('compacting', () => {
  it('shows compacting from /compact until the boundary arrives', () => {
    const { s, handle } = fakeSession();
    s.sendPrompt('/compact');
    expect(s.state.session.compacting).toBe(true);
    expect(s.state.status).toBe('Compacting the conversation');
    handle({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'manual', pre_tokens: 295_000, post_tokens: 12_000 } });
    expect(s.state.session.compacting).toBe(false);
    expect(s.state.session.context).toBe(12_000);
  });

  it('a CLI exit while compacting lets the next message go out', async () => {
    const { s } = fakeSession();
    const priv = s.driver as unknown as { q: unknown; consume: () => Promise<void>; start: () => void };
    vi.spyOn(priv, 'start').mockImplementation(() => {});
    s.sendPrompt('/compact');
    priv.q = { async *[Symbol.asyncIterator]() {} };
    await priv.consume();
    expect(s.state.session.compacting).toBe(false);
    await s.steer('go on', 'm1');
    expect(s.state.events.find((e) => e.id === 'm1')).toMatchObject({ kind: 'user', text: 'go on' });
    expect(s.state.events.find((e) => e.id === 'm1')).not.toHaveProperty('queued', true);
    expect(s.state.session.running).toBe(true);
  });

  it('compacts automatically when a turn ends past 200k, once', () => {
    const { s, result } = fakeSession();
    const compact = vi.spyOn(s.driver, 'compact');
    s.sendPrompt('big task');
    s.state.session.context = 210_000;
    result('r1');
    expect(compact).toHaveBeenCalledOnce();
    expect(s.state.session.compacting).toBe(true);
    result('r2');
    expect(s.state.session.running).toBe(false);
  });

  it('/compact calls the driver and sends no prompt', () => {
    const { s } = fakeSession();
    const compact = vi.spyOn(s.driver, 'compact').mockImplementation(() => {});
    const send = vi.spyOn(s.driver, 'send');
    s.sendPrompt('/compact');
    expect(compact).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    expect(s.state.session.compacting).toBe(true);
  });

  it('sends a steer held while compacting once the compaction ends', async () => {
    const { s, handle } = fakeSession();
    vi.spyOn(s.driver, 'compact').mockImplementation(() => {});
    const send = vi.spyOn(s.driver, 'send');
    s.sendPrompt('/compact');
    await s.steer('after compact', 'm1');
    expect(send).not.toHaveBeenCalled();
    handle({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'manual', pre_tokens: 295_000, post_tokens: 12_000 } });
    expect(send).toHaveBeenCalledWith('after compact', 'm1');
  });

  it('keeps a steer held when the CLI compacts mid-turn on its own', async () => {
    const { s, handle } = fakeSession();
    const send = vi.spyOn(s.driver, 'send');
    s.sendPrompt('big task');
    handle({ type: 'system', subtype: 'status', status: 'compacting' });
    await s.steer('later', 'm1');
    handle({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 295_000, post_tokens: 12_000 } });
    expect(send).not.toHaveBeenCalledWith('later', 'm1');
  });

  it('compacts at 80% of the context window when the agent reports one', () => {
    const { s, result } = fakeSession();
    const compact = vi.spyOn(s.driver, 'compact').mockImplementation(() => {});
    s.sendPrompt('big task');
    s.state.session.contextWindow = 100_000;
    s.state.session.context = 79_000;
    result('r1');
    expect(compact).not.toHaveBeenCalled();
    s.sendPrompt('more');
    s.state.session.context = 81_000;
    result('r2');
    expect(compact).toHaveBeenCalledOnce();
  });

  it('stops compacting and says why when it fails', () => {
    const { s, handle } = fakeSession();
    s.sendPrompt('/compact');
    handle({ type: 'system', subtype: 'status', status: null, compact_result: 'failed', compact_error: 'Prompt is too long' });
    expect(s.state.session.compacting).toBe(false);
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: 'Compact failed: Prompt is too long' });
  });

  it('retries a failed auto-compact once the context grows 20k', () => {
    const { s, handle, result } = fakeSession();
    s.sendPrompt('big task');
    s.state.session.context = 210_000;
    result('r1');
    handle({ type: 'system', subtype: 'status', status: null, compact_result: 'failed', compact_error: 'Prompt is too long' });
    result('rc');
    s.sendPrompt('more');
    s.state.session.context = 225_000;
    result('r2');
    expect(s.state.session.compacting).toBe(false);
    s.sendPrompt('more');
    s.state.session.context = 231_000;
    result('r3');
    expect(s.state.session.compacting).toBe(true);
  });
});

describe('fireTime', () => {
  const now = new Date(2026, 9, 17, 21, 41).getTime();
  it('reads a one-shot cron as a local time', () => {
    expect(fireTime('6 22 17 10 *', now)).toBe(new Date(2026, 9, 17, 22, 6).getTime());
  });
  it('rolls a past date into next year', () => {
    expect(fireTime('0 9 1 1 *', now)).toBe(new Date(2027, 0, 1, 9, 0).getTime());
  });
  it('ignores recurring expressions', () => {
    expect(fireTime('*/30 * * * *', now)).toBeNull();
  });
});

describe('blocked tools', () => {
  it('allows a rule once, marks every card for it and does not re-prompt', async () => {
    const { s } = fakeSession();
    const applyFlagSettings = vi.fn(async () => {});
    Object.assign(s.driver, { q: { interrupt: vi.fn(), applyFlagSettings } });
    const priv = s as unknown as { blocked: (id: string, tool: string, reason: string) => void };
    const users = () => s.state.events.filter((e) => e.kind === 'user');
    const cards = () => s.state.events.filter((e) => e.kind === 'blocked').map((e) => e.kind === 'blocked' && e.allowed);
    priv.blocked('t1', 'mcp__chrome__computer', 'not allowed');
    priv.blocked('t2', 'mcp__chrome__computer', 'not allowed');
    await s.allowBlocked('t1:blocked');
    await new Promise((r) => setTimeout(r, 0));
    expect(applyFlagSettings).toHaveBeenCalledOnce();
    expect(cards()).toEqual([true, true]);
    expect(users()).toHaveLength(1);
    priv.blocked('t3', 'mcp__chrome__computer', 'not allowed');
    await s.allowBlocked('t3:blocked');
    await new Promise((r) => setTimeout(r, 0));
    expect(applyFlagSettings).toHaveBeenCalledOnce();
    expect(cards()).toEqual([true, true, true]);
    expect(users()).toHaveLength(1);
  });
});

describe('streaming', () => {
  it('sends only the text added per flush window, a client rebuilds it, and the full event on stop', async () => {
    const { s, handle } = fakeSession();
    const sent: ServerMessage[] = [];
    s.onMessage((m) => sent.push(JSON.parse(JSON.stringify(m))));
    const delta = (text: string) => handle({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } });
    handle({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } });
    delta('Hel');
    delta('lo ');
    delta('wor');
    const events = () => sent.flatMap((m) => (m.type === 'event' && m.event.kind === 'assistant' ? [[m.event.text, m.event.streaming]] : []));
    const appends = () => sent.flatMap((m) => (m.type === 'append' ? [[m.offset, m.text]] : []));
    expect(events()).toEqual([['Hel', true]]);
    await new Promise((r) => setTimeout(r, 120));
    expect(appends()).toEqual([[3, 'lo wor']]);
    delta('ld');
    await new Promise((r) => setTimeout(r, 120));
    expect(appends()).toEqual([[3, 'lo wor'], [9, 'ld']]);
    const first = sent.find((m) => m.type === 'event' && m.event.kind === 'assistant')!;
    let client = first.type === 'event' ? first.event : null!;
    for (const m of sent) if (m.type === 'append') client = appendTo(client, m.offset, m.text) ?? client;
    expect(client).toMatchObject({ text: 'Hello world', streaming: true });
    // A replayed append adds nothing; one past a gap is refused until the full event arrives.
    expect(appendTo(client, 3, 'lo wor')).toBeNull();
    expect(appendTo(client, 20, 'x')).toBeNull();
    handle({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } });
    expect(events()).toEqual([['Hel', true], ['Hello world', false]]);
    expect(s.state.events.filter((e) => e.kind === 'assistant')).toHaveLength(1);
  });
});

describe('turns the CLI starts by itself', () => {
  it('marks a hand-back turn as running until its result', () => {
    const { s, result, handle } = fakeSession();
    expect(s.state.session.running).toBe(false);
    handle({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } });
    expect(s.state.session.running).toBe(true);
    expect(s.state.events.filter((e) => e.kind === 'system').map((e) => e.kind === 'system' && e.text)).toEqual(['Claude continued after a background task']);
    handle({ type: 'stream_event', parent_tool_use_id: 'sub', event: { type: 'message_start', message: { id: 'm2' } } });
    result('r1');
    expect(s.state.session.running).toBe(false);
  });

  it('marks the session running when a background agent reports while idle', () => {
    const { s, result, handle } = fakeSession();
    handle({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'ag', name: 'Agent', input: { description: 'Survey', run_in_background: true } }] } });
    result('r1');
    expect(s.state.session.running).toBe(false);
    handle({ type: 'system', subtype: 'task_notification', task_id: 'a1', tool_use_id: 'ag', status: 'completed', summary: 'Agent finished' });
    expect(s.state.session.running).toBe(true);
  });

  it('drops a dead query so the next prompt starts a fresh one', async () => {
    const { s } = fakeSession();
    const priv = s.driver as unknown as { q: unknown; input: { stream(): AsyncGenerator }; consume: () => Promise<void>; start: () => void };
    priv.q = { async *[Symbol.asyncIterator]() {} };
    const stale = priv.input.stream();
    s.sendPrompt('first');
    await priv.consume();
    expect(priv.q).toBeNull();
    expect((await stale.next()).done).toBe(true);
    expect(s.state.session.running).toBe(false);
    const start = vi.spyOn(priv, 'start').mockImplementation(() => {});
    s.sendPrompt('second');
    expect(start).toHaveBeenCalledOnce();
  });
});

describe('review findings', () => {
  it('a ReportFindings call after /code-review reaches the viewers with its PR number', async () => {
    const { s } = fakeSession();
    const got: ServerMessage[] = [];
    s.onMessage((m) => got.push(m));
    s.sendPrompt('/code-review 42');
    (s.driver as unknown as { messages: { toolUse: (b: unknown) => void } }).messages.toolUse({ id: 't1', name: 'ReportFindings', input: { findings: [{ file: 'x.ts', line: 9, summary: 'Leak' }] } });
    await vi.waitFor(() => expect(got.some((m) => m.type === 'findings')).toBe(true));
    expect(got.find((m) => m.type === 'findings')).toMatchObject({ review: { repo: '/tmp/project', target: '42', findings: [{ file: 'x.ts', line: 9, summary: 'Leak' }] } });
  });
});

describe('rewind files', () => {
  it('rewinds to the uuid the CLI echoed for the prompt, or the history id', async () => {
    const { s, result, handle } = fakeSession();
    const rewindFiles = vi.fn(async () => ({ canRewind: true, filesChanged: ['/tmp/project/a.ts'] }));
    Object.assign(s.driver, { q: { interrupt: vi.fn(), rewindFiles } });
    await s.prompt('fix it', 'ev1');
    handle({ type: 'user', uuid: 'u1', parent_tool_use_id: null, message: { role: 'user', content: 'fix it' } });
    await s.rewind('ev1');
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: 'Stop Claude before rewinding files' });
    result('r1');
    await s.rewind('ev1');
    expect(rewindFiles).toHaveBeenCalledWith('u1');
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: 'Rewound 1 file to before that prompt' });
    expect(s.state.recentFiles).toEqual(['a.ts']);
    await s.rewind('hist-uuid:3');
    expect(rewindFiles).toHaveBeenLastCalledWith('hist-uuid');
    rewindFiles.mockResolvedValueOnce({ canRewind: false, error: 'no checkpoint', filesChanged: [] });
    await s.rewind('ev1');
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: 'Rewind failed: no checkpoint' });
  });
});

describe('pull request link', () => {
  const create = { type: 'tool_use', id: 'gh1', name: 'Bash', input: { command: 'gh pr create --title "Fix" --body "x"' } };
  const made = { type: 'tool_result', tool_use_id: 'gh1', content: 'Creating pull request for a into main in o/r\n\nhttps://github.com/o/r/pull/42\n' };

  it('records the PR number a gh pr create printed, live and from history', async () => {
    const { s, handle } = fakeSession();
    await s.prompt('open a PR');
    handle({ type: 'assistant', parent_tool_use_id: null, message: { content: [create], usage: {} } });
    handle({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [made] } });
    expect(s.state.session.pr).toBe(42);
    const events: ChatEvent[] = [
      { id: 'gh1', kind: 'tool_use', name: 'Bash', input: create.input, summary: '', at: 1 },
      { id: 'r', kind: 'tool_result', toolUseId: 'gh1', text: made.content, isError: false, at: 2 },
    ];
    expect(prFrom(events)).toBe(42);
    expect(prFrom([{ id: 'x', kind: 'tool_result', toolUseId: 'other', text: made.content, isError: false, at: 2 }])).toBeNull();
  });

  it('records it from the events of any driver, top-level only', () => {
    const { s } = fakeSession();
    s.pushEvent({ id: 'gh1', kind: 'tool_use', name: 'Bash', input: create.input, summary: '', at: 1 });
    s.pushEvent({ id: 'r', kind: 'tool_result', toolUseId: 'gh1', text: made.content, isError: false, at: 2, parent: 'ag' });
    expect(s.state.session.pr).toBeNull();
    s.pushEvent({ id: 'r2', kind: 'tool_result', toolUseId: 'gh1', text: made.content, isError: false, at: 3 });
    expect(s.state.session.pr).toBe(42);
  });
});

describe('event index', () => {
  const handle = (s: ReturnType<typeof fakeSession>['s'], msg: unknown) => (s.driver as unknown as { handle: (m: unknown) => void }).handle(msg);
  const use = (s: ReturnType<typeof fakeSession>['s'], id: string, name = 'Read') => handle(s, { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id, name, input: {} }] } });

  it('finds events pushed, after a trim, and agents patched in place', () => {
    const { s } = fakeSession();
    use(s, 'ag', 'Agent');
    expect(s.eventById('ag')).toMatchObject({ kind: 'tool_use' });
    expect(s.agentOf('ag')).toMatchObject({ status: 'running' });
    handle(s, { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'ag', content: 'ok' }] } });
    expect(s.agentOf('ag')).toMatchObject({ status: 'done' });
    expect(s.agentOf('ag')).toBe(s.state.events.find((e) => e.kind === 'agent'));
    for (let i = 0; i < 3600; i++) use(s, `t${i}`);
    expect(s.state.events.length).toBeLessThan(3600);
    expect(s.eventById('ag')).toBeUndefined();
    expect(s.agentOf('ag')).toBeUndefined();
    expect(s.eventById('t0')).toBeUndefined();
    expect(s.eventById('t3599')).toBe(s.state.events.at(-1));
    use(s, 't-new');
    expect(s.eventById('t-new')).toBe(s.state.events.at(-1));
  });

  it('records the session model on each result', async () => {
    const { s, result } = fakeSession();
    Object.assign(s.driver, { q: { interrupt: vi.fn(), setModel: vi.fn(async () => {}), applyFlagSettings: vi.fn(async () => {}), setPermissionMode: vi.fn(async () => {}) } });
    const modelOf = () => (s.state.events.filter((e) => e.kind === 'result').at(-1) as { model?: string | null }).model;
    s.state.session.model = null;
    result('r1');
    expect(modelOf()).toBeNull();
    s.state.session.model = 'a';
    await s.setModel('b');
    result('r2');
    expect(modelOf()).toBe('b');
  });

});

describe('event windows', () => {
  const filled = (n: number) => {
    const { s } = fakeSession();
    for (let i = 0; i < n; i++) s.state.events.push({ id: `e${i}`, kind: 'user', text: '', at: i });
    return s;
  };

  it('view cuts the tail with a count of the rest and leaves the state alone', () => {
    const s = filled(400);
    const v = s.view(150);
    expect(v.events).toHaveLength(150);
    expect(v.earlier).toBe(250);
    expect(v.events[0].id).toBe('e250');
    expect(s.state.events).toHaveLength(400);
    expect(s.view().events).toHaveLength(400);
    expect(s.view().earlier).toBeUndefined();
    const small = filled(100).view(150);
    expect(small.events).toHaveLength(100);
    expect(small.earlier).toBeUndefined();
  });

  it('before pages back from an event and clamps the limit', () => {
    const s = filled(800);
    const page = s.before('e250');
    expect(page.events.map((e) => e.id)).toEqual(s.state.events.slice(100, 250).map((e) => e.id));
    expect(page.earlier).toBe(100);
    expect(s.before('e250', 10).events).toHaveLength(10);
    expect(s.before('e799', 0).events).toHaveLength(1);
    expect(s.before('e799', 9999).events).toHaveLength(500);
    expect(s.before('e5')).toEqual({ events: s.state.events.slice(0, 5), earlier: 0 });
    expect(s.before('e0')).toEqual({ events: [], earlier: 0 });
    expect(() => s.before('gone')).toThrow();
  });

  it('an init the session emits carries every event and no earlier', () => {
    const s = filled(400);
    const seen: { events: unknown[]; earlier?: number }[] = [];
    s.onMessage((m) => { if (m.type === 'init') seen.push(m.state); });
    s.replaceHistory({ events: s.state.events, context: s.state.session.context, cache: s.state.session.cache } as never);
    expect(seen).toHaveLength(1);
    expect(seen[0].events).toHaveLength(400);
    expect(seen[0].earlier).toBeUndefined();
  });
});

describe('restart resume', () => {
  const start = (handle: (m: unknown) => void, id: string, tool_use_id: string) =>
    handle({ type: 'system', subtype: 'task_started', task_id: id, tool_use_id, task_type: 'local_bash', description: 'sleep 60' });

  it('lists a started background task until its notification, and busy follows it', () => {
    const { s, handle, result } = fakeSession();
    handle({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'sleep 60', run_in_background: true } }] } });
    start(handle, 't1', 'tu1');
    result('r1');
    expect(s.driver.runningTasks()).toMatchObject([{ toolUseId: 'tu1', description: 'sleep 60' }]);
    expect(busy(s)).toBe(true);
    handle({ type: 'system', subtype: 'task_notification', task_id: 't1', tool_use_id: 'tu1', status: 'completed', summary: 'done' });
    expect(s.driver.runningTasks()).toEqual([]);
    result('r2');
    expect(busy(s)).toBe(false);
  });

  it('resumeStopped adds one user event with the run id, and an untouched chat has none', () => {
    const { s } = fakeSession();
    const users = () => s.state.events.filter((e) => e.kind === 'user');
    expect(users()).toHaveLength(0);
    s.resumeStopped({ midTurn: true, tasks: [{ description: 'build', tool: 'Workflow', runId: 'wf_abc', scriptPath: '/p/build.js' }] });
    expect(users()).toHaveLength(1);
    const text = users()[0].kind === 'user' ? users()[0].text : '';
    expect(text).toContain('wf_abc');
    expect(text).toContain('resumeFromRunId');
  });
});

describe('job runs', () => {
  const jobSession = () => {
    const f = fakeSession();
    f.s.runs = new Runs();
    const id = f.s.runs.start({ kind: 'job', sessionId: '', chatId: f.s.id, title: 'Fix', what: 'Fix it', provider: 'claude', jobId: 'j1', branch: 'jobs/fix-1', repo: '/r', worktree: '/w', paseo: false });
    return { ...f, runs: f.s.runs, id };
  };

  it('is paused as Needs you while a permission waits, and runs again once it is answered', () => {
    const { s, runs, id } = jobSession();
    s.links.waitingOnUser(true);
    expect(runs.get(id)).toMatchObject({ state: 'paused', why: WAITING, needsYou: true });
    s.links.waitingOnUser(false);
    expect(runs.get(id)).toMatchObject({ state: 'running', needsYou: false });
  });

  it('adds one round and ends when the turn ends', () => {
    const { s, runs, id, result } = jobSession();
    s.sendPrompt('go');
    result('r1');
    expect(runs.get(id)).toMatchObject({ state: 'done', why: 'turn finished', rounds: [{ n: 1, line: 'done' }] });
    expect(runs.jobFor(s.id)).toBeUndefined();
  });

  it('ends Failed with the error line when the turn ends in an error', () => {
    const { s, runs, id, handle } = jobSession();
    s.sendPrompt('go');
    handle({ type: 'result', subtype: 'error_during_execution', uuid: 'r1', errors: ['Sandbox dependencies are missing'], total_cost_usd: 0, is_error: true });
    expect(runs.get(id)).toMatchObject({ state: 'done', rounds: [{ outcome: 'failed', line: 'Turn ended: error_during_execution: Sandbox dependencies are missing' }] });
  });
});
