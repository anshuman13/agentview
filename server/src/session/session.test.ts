import { describe, expect, it, vi } from 'vitest';
import { fireTime, prFrom, type AgentSession } from './session.js';
import { claudeSession, type ClaudeDriver } from '../agent/claude/driver.js';
import { historyFrom } from '../agent/claude/transcript.js';
import type { History } from '../agent/types.js';
import { BIG_BRO, type ChatEvent, type ServerMessage } from '../../../shared/protocol.js';

vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/agentview-test-${process.pid}`;
  process.env.CLAUDE_CONFIG_DIR = dir;
  process.env.AGENTVIEW_ALT_CLAUDE = `${dir}/alt`;
  process.env.AGENTVIEW_LIMITS_DIR = dir;
});

function fakeSession() {
  const s = claudeSession('/tmp/project');
  const interrupt = vi.fn(async () => {});
  Object.assign(s.driver, { q: { interrupt } });
  const handle = (msg: unknown) => (s.driver as unknown as { handle: (m: unknown) => void }).handle(msg);
  const result = (uuid: string, subtype = 'success') => handle({ type: 'result', subtype, uuid, result: 'done', total_cost_usd: 0, is_error: subtype !== 'success' });
  return { s, interrupt, result, handle };
}

describe('AgentSession turns', () => {

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
    Object.assign(s2.driver, { inputQueue: [] });
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
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: expect.stringContaining('Loop stopped') });
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
    expect(s.state.events.some((e) => e.kind === 'system' && e.text === 'Loop stopped: the plan was not approved')).toBe(true);
  });

  it('continues on the other account when a turn ends on a usage limit', async () => {
    const { s, handle } = fakeSession();
    const limitHit = vi.fn(() => 'alt' as const);
    Object.assign(s.driver, { limitHit, accounts: () => ['main', 'alt'] });
    s.sendPrompt('long task');
    handle({ type: 'result', subtype: 'success', uuid: 'r1', result: "You've hit your session limit · resets 1:50am", total_cost_usd: 0, is_error: false });
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

  it('waits for the reset when no other account has usage left', async () => {
    const { s, handle } = fakeSession();
    Object.assign(s.driver, { limitHit: vi.fn(() => null) });
    s.sendPrompt('long task');
    handle({ type: 'result', subtype: 'success', uuid: 'r1', result: "You've hit your session limit · resets 1:50am", total_cost_usd: 0, is_error: false });
    expect(s.state.session).toMatchObject({ account: 'main', running: false });
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: expect.stringContaining('Usage limit reached') });
  });

  it('switches account only when idle and logged in', () => {
    const { s } = fakeSession();
    const setAccount = vi.fn();
    Object.assign(s.driver, { setAccount, accounts: () => ['main'] });
    s.setAccount('alt');
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: expect.stringContaining('No work Claude account') });
    Object.assign(s.driver, { accounts: () => ['main', 'alt'] });
    s.sendPrompt('work');
    s.setAccount('alt');
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: 'Stop Claude before switching account' });
    expect(setAccount).not.toHaveBeenCalled();
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

  it('interrupt marks stopping until the turn ends', async () => {
    const { s, interrupt, result } = fakeSession();
    s.sendPrompt('task');
    Object.assign(s.driver, { inputQueue: [] });
    await s.interrupt();
    expect(interrupt).toHaveBeenCalledOnce();
    expect(s.state.session.stopping).toBe(true);
    result('r1', 'error_during_execution');
    expect(s.state.session).toMatchObject({ running: false, stopping: false });
  });

  it('does not auto-compact after a stop', async () => {
    const { s, result } = fakeSession();
    s.sendPrompt('big task');
    Object.assign(s.driver, { inputQueue: [] });
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
    Object.assign(s.driver, { inputQueue: [] });
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
    (s.driver as unknown as { confirmBigBro: (i: unknown, sig: AbortSignal) => Promise<any> }).confirmBigBro(
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
    const out = (s.driver as ClaudeDriver).afterTool(hook) as { hookSpecificOutput?: { additionalContext?: string } };
    expect(out.hookSpecificOutput?.additionalContext).toContain('1. curl /check\n2. stop the server');
    expect((s.driver as ClaudeDriver).afterTool(hook)).toEqual({});
  });

  it('skips sub-agent tool calls', () => {
    const { s } = fakeSession();
    s.sendPrompt('task');
    s.changePlan(['a']);
    expect((s.driver as ClaudeDriver).afterTool({ ...(hook as object), agent_id: 'sub' } as never)).toEqual({});
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
    const text = () => ((s.driver as ClaudeDriver).afterTool(hook) as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput?.additionalContext;
    for (let i = 0; i < 7; i++) expect(text()).toBeUndefined();
    expect(text()).toContain('set_status');
    (s.driver as ClaudeDriver).afterTool({ ...(hook as object), tool_name: 'mcp__agentview__set_status' } as never);
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
    const apply = () => (s as unknown as { applyHistory: (h: History) => ChatEvent[] }).applyHistory((s.driver as unknown as { history: (m: unknown[], subs: object) => History }).history(history, {}));
    s.state.events = apply();
    const agent = () => s.state.events.find((e) => e.kind === 'agent');
    expect(agent()).toMatchObject({ status: 'running' });
    await s.stopTask('ag');
    expect(agent()).toMatchObject({ status: 'stopped' });
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'tool_result', toolUseId: 'ag', stopped: true });
    s.state.events = apply();
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
    s.sendPrompt('big task');
    s.state.session.context = 210_000;
    result('r1');
    expect(s.state.events.filter((e) => e.kind === 'user').at(-1)).toMatchObject({ text: '/compact' });
    expect(s.state.session.compacting).toBe(true);
    result('r2');
    expect(s.state.session.running).toBe(false);
  });

  it('stops compacting and says why when it fails', () => {
    const { s, handle } = fakeSession();
    s.sendPrompt('/compact');
    handle({ type: 'system', subtype: 'status', status: null, compact_result: 'failed', compact_error: 'Prompt is too long' });
    expect(s.state.session.compacting).toBe(false);
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: 'Compact failed: Prompt is too long' });
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
  it('coalesces text deltas into one update per flush window and a final one on stop', async () => {
    const { s, handle } = fakeSession();
    const sent: ServerMessage[] = [];
    s.onMessage((m) => sent.push(JSON.parse(JSON.stringify(m))));
    const delta = (text: string) => handle({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } });
    handle({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } });
    delta('Hel');
    delta('lo ');
    delta('wor');
    const texts = () => sent.filter((m) => m.type === 'event' && m.event.kind === 'assistant').map((m) => m.type === 'event' && m.event.kind === 'assistant' && [m.event.text, m.event.streaming]);
    expect(texts()).toEqual([['Hel', true]]);
    await new Promise((r) => setTimeout(r, 120));
    expect(texts()).toEqual([['Hel', true], ['Hello wor', true]]);
    delta('ld');
    handle({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } });
    expect(texts()).toEqual([['Hel', true], ['Hello wor', true], ['Hello world', false]]);
    await new Promise((r) => setTimeout(r, 120));
    expect(texts()).toHaveLength(3);
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
    const priv = s.driver as unknown as { q: unknown; gen: number; consume: () => Promise<void>; start: () => void };
    priv.q = { async *[Symbol.asyncIterator]() {} };
    const gen = priv.gen;
    s.sendPrompt('first');
    await priv.consume();
    expect(priv.q).toBeNull();
    expect(priv.gen).toBe(gen + 1);
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
    (s.driver as unknown as { toolUse: (b: unknown) => void }).toolUse({ id: 't1', name: 'ReportFindings', input: { findings: [{ file: 'x.ts', line: 9, summary: 'Leak' }] } });
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

});
