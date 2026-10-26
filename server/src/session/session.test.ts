import { describe, expect, it, vi } from 'vitest';
import { fireTime, prFrom, type AgentSession } from './session.js';
import { claudeSession, type ClaudeDriver } from '../agent/claude/driver.js';
import { BIG_BRO, historyFrom } from '../agent/claude/transcript.js';
import type { History } from '../agent/types.js';
import type { ChatEvent, ServerMessage } from '../../../shared/protocol.js';

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
  return { s, interrupt, result };
}

describe('AgentSession turns', () => {
  it('stops running when the only turn ends', () => {
    const { s, result } = fakeSession();
    s.sendPrompt('hi');
    expect(s.state.session.running).toBe(true);
    result('r1');
    expect(s.state.session.running).toBe(false);
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

  it('queues a prompt sent while running and sends it when the turn ends', async () => {
    const { s, interrupt, result } = fakeSession();
    s.sendPrompt('long task');
    await s.prompt('next thing');
    expect(interrupt).not.toHaveBeenCalled();
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'user', text: 'next thing', queued: true });
    result('r1');
    expect(s.state.session.running).toBe(true);
    expect(s.state.events.find((e) => e.kind === 'user' && e.text === 'next thing')).toMatchObject({ queued: false });
    result('r2');
    expect(s.state.session.running).toBe(false);
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
    const { s } = fakeSession();
    const limitHit = vi.fn(() => 'alt' as const);
    Object.assign(s.driver, { limitHit, accounts: () => ['main', 'alt'] });
    const handle = (msg: unknown) => (s.driver as unknown as { handle: (m: unknown) => void }).handle(msg);
    s.sendPrompt('long task');
    handle({ type: 'result', subtype: 'success', uuid: 'r1', result: "You've hit your session limit · resets 1:50am", total_cost_usd: 0, is_error: false });
    expect(limitHit).toHaveBeenCalledOnce();
    expect(s.state.session).toMatchObject({ account: 'alt', running: true });
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'user', text: expect.stringContaining('Continue where you stopped') });
  });

  it('waits for the reset when no other account has usage left', async () => {
    const { s } = fakeSession();
    Object.assign(s.driver, { limitHit: vi.fn(() => null) });
    const handle = (msg: unknown) => (s.driver as unknown as { handle: (m: unknown) => void }).handle(msg);
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

  it('ignores a message resent with an id it already has', async () => {
    const { s, interrupt } = fakeSession();
    await s.prompt('hello', 'p1');
    await s.prompt('hello', 'p1');
    expect(s.state.events.filter((e) => e.kind === 'user')).toHaveLength(1);
    await s.steer('again', 's1');
    await s.steer('again', 's1');
    expect(s.state.events.filter((e) => e.kind === 'user')).toHaveLength(2);
    expect(interrupt).toHaveBeenCalledTimes(1);
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

  it('interrupt drops queued prompts and is a no-op when idle', async () => {
    const { s, interrupt } = fakeSession();
    await s.interrupt();
    expect(interrupt).not.toHaveBeenCalled();
    s.sendPrompt('queued');
    await s.interrupt();
    expect(s.state.session.running).toBe(false);
  });

  it('steer only sends when idle', async () => {
    const { s, interrupt } = fakeSession();
    await s.steer('next thing');
    expect(interrupt).not.toHaveBeenCalled();
    expect(s.state.session.running).toBe(true);
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

  it('lets other agents through untouched', async () => {
    expect(await call(claudeSession('/tmp/p'), 'Explore')).toEqual({});
  });

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

  it('denies when the user declines', async () => {
    const s = claudeSession('/tmp/p');
    const decision = call(s, BIG_BRO);
    s.answerPermission(s.state.pending[0].id, false);
    expect((await decision).hookSpecificOutput).toMatchObject({ permissionDecision: 'deny' });
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

  it('sends right away when idle', () => {
    const { s } = fakeSession();
    s.changePlan([]);
    expect(s.state.session.running).toBe(true);
  });
});

describe('subagents', () => {
  const launched = 'Async agent launched successfully.\nagentId: a1';

  it('keeps a background agent running until its notification and tags its steps', () => {
    const { s } = fakeSession();
    const handle = (msg: unknown) => (s.driver as unknown as { handle: (m: unknown) => void }).handle(msg);
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

  it('rebuilds subagent steps and the report from history', () => {
    const msg = (type: string, content: unknown) => ({ type, uuid: 'u', session_id: 's', parent_tool_use_id: null, timestamp: '2026-10-15T10:00:00Z', message: { content } }) as never;
    const { events } = historyFrom(
      [
        msg('user', 'survey'),
        msg('assistant', [{ type: 'tool_use', id: 'ag', name: 'Agent', input: { description: 'Survey' } }]),
        msg('user', [{ type: 'tool_result', tool_use_id: 'ag', content: launched }]),
        msg('user', '<task-notification>\n<tool-use-id>ag</tool-use-id>\n<status>completed</status>\n<summary>Agent finished</summary>\n<result>Found 3 docs</result>\n</task-notification>'),
      ],
      { ag: [msg('assistant', [{ type: 'tool_use', id: 'g1', name: 'Grep', input: { pattern: 'x' } }]), msg('user', [{ type: 'tool_result', tool_use_id: 'g1', content: 'hit' }])] },
    );
    const results = events.filter((e) => e.kind === 'tool_result' && e.toolUseId === 'ag');
    expect(results).toMatchObject([{ text: 'Found 3 docs', isError: false }]);
    expect(events.filter((e) => 'parent' in e && e.parent === 'ag')).toMatchObject([{ kind: 'tool_use', name: 'Grep' }, { kind: 'tool_result', text: 'hit' }]);
  });

  it('keeps the full agent report and caps other tool results', () => {
    const { s } = fakeSession();
    const handle = (msg: unknown) => (s.driver as unknown as { handle: (m: unknown) => void }).handle(msg);
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
    const { s } = fakeSession();
    const handle = (msg: unknown) => (s.driver as unknown as { handle: (m: unknown) => void }).handle(msg);
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
    const { s } = fakeSession();
    const handle = (msg: unknown) => (s.driver as unknown as { handle: (m: unknown) => void }).handle(msg);
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

  it('forwards subagent text live and from history', () => {
    const { s } = fakeSession();
    const handle = (msg: unknown) => (s.driver as unknown as { handle: (m: unknown) => void }).handle(msg);
    handle({ type: 'assistant', parent_tool_use_id: 'ag', message: { content: [{ type: 'text', text: 'Looking around' }] } });
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'assistant', text: 'Looking around', parent: 'ag' });
    const msg = (type: string, content: unknown) => ({ type, uuid: 'u', session_id: 's', parent_tool_use_id: null, timestamp: '2026-10-15T10:00:00Z', message: { content } }) as never;
    const { events } = historyFrom([msg('user', 'survey')], { ag: [msg('assistant', [{ type: 'text', text: 'Looking around' }])] });
    expect(events.filter((e) => e.kind === 'assistant')).toMatchObject([{ text: 'Looking around', parent: 'ag' }]);
  });

  it('uses the hand-back report', () => {
    const { s } = fakeSession();
    const handle = (msg: unknown) => (s.driver as unknown as { handle: (m: unknown) => void }).handle(msg);
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
    const { s } = fakeSession();
    const handle = (msg: unknown) => (s.driver as unknown as { handle: (m: unknown) => void }).handle(msg);
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
    const { s } = fakeSession();
    const handle = (msg: unknown) => (s.driver as unknown as { handle: (m: unknown) => void }).handle(msg);
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
    const { s } = fakeSession();
    const sent: ServerMessage[] = [];
    s.onMessage((m) => sent.push(JSON.parse(JSON.stringify(m))));
    const handle = (msg: unknown) => (s.driver as unknown as { handle: (m: unknown) => void }).handle(msg);
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
    const { s, result } = fakeSession();
    const handle = (msg: unknown) => (s.driver as unknown as { handle: (m: unknown) => void }).handle(msg);
    expect(s.state.session.running).toBe(false);
    handle({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } });
    expect(s.state.session.running).toBe(true);
    expect(s.state.events.filter((e) => e.kind === 'system').map((e) => e.kind === 'system' && e.text)).toEqual(['Claude continued after a background task']);
    handle({ type: 'stream_event', parent_tool_use_id: 'sub', event: { type: 'message_start', message: { id: 'm2' } } });
    result('r1');
    expect(s.state.session.running).toBe(false);
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

describe('/loop after Stop', () => {
  it('a back to back loop fires again after a grace period, not at once', async () => {
    vi.useFakeTimers();
    const { s, interrupt, result } = fakeSession();
    await s.prompt('/loop until 23:59 do the next round');
    expect(s.state.events.filter((e) => e.kind === 'user').map((e) => e.kind === 'user' && e.text)).toEqual(['/loop until 23:59 do the next round', 'do the next round']);
    Object.assign(s.driver, { inputQueue: [] });
    await s.interrupt();
    expect(interrupt).toHaveBeenCalledOnce();
    result('r1', 'error_during_execution');
    expect(s.state.session.running).toBe(false);
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: expect.stringMatching(/^Loop round 2 at \d\d:\d\d/) });
    vi.advanceTimersByTime(60_000);
    expect(s.state.events.filter((e) => e.kind === 'user')).toHaveLength(2);
    vi.advanceTimersByTime(61_000);
    expect(s.state.events.filter((e) => e.kind === 'user')).toHaveLength(3);
    expect(s.state.session.repeat?.round).toBe(2);
    vi.useRealTimers();
  });

  it('a round that ends at once does not spin the loop', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 24, 3, 0, 0));
    const { s, result } = fakeSession();
    await s.prompt('/loop until 06:59 do the next round');
    const users = () => s.state.events.filter((e) => e.kind === 'user').length;
    expect(users()).toBe(2);
    result('r1');
    expect(s.state.session.running).toBe(false);
    expect(users()).toBe(2);
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: expect.stringMatching(/^Loop round 2 at 03:02/) });
    vi.advanceTimersByTime(2 * 60_000 + 1000);
    expect(users()).toBe(3);
    expect(s.state.session.repeat?.round).toBe(2);
    vi.useRealTimers();
  });

  it('a usage limit holds the loop until the reset time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 24, 0, 0, 0));
    const { s, result } = fakeSession();
    const handle = (msg: unknown) => (s.driver as unknown as { handle: (m: unknown) => void }).handle(msg);
    await s.prompt('/loop until 06:59 do the next round');
    handle({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: "You've hit your session limit · resets 1:50am (Europe/Oslo)" }], usage: {} } });
    result('r1');
    expect(s.state.session.running).toBe(false);
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: 'Usage limit reached, loop round 2 at 01:51, /loop off to end it' });
    vi.advanceTimersByTime(110 * 60_000);
    expect(s.state.events.filter((e) => e.kind === 'user')).toHaveLength(2);
    vi.advanceTimersByTime(2 * 60_000);
    expect(s.state.events.filter((e) => e.kind === 'user')).toHaveLength(3);
    vi.useRealTimers();
  });

  it('a usage limit without a loop leaves a note, and /loop at sends the prompt once', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 24, 0, 0, 0));
    const { s, result } = fakeSession();
    const handle = (msg: unknown) => (s.driver as unknown as { handle: (m: unknown) => void }).handle(msg);
    await s.prompt('do the next round');
    handle({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: "You've hit your session limit · resets 1:50am (Europe/Oslo)" }], usage: {} } });
    result('r1');
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: 'Usage limit reached, resets at 01:51' });
    expect(s.state.session.repeat).toBeNull();
    await s.prompt('/loop at 01:51 do the next round');
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: 'Loop on, once at 01:51' });
    const prompts = () => s.state.events.filter((e) => e.kind === 'user' && e.text === 'do the next round').length;
    vi.advanceTimersByTime(110 * 60_000);
    expect(prompts()).toBe(1);
    vi.advanceTimersByTime(2 * 60_000);
    expect(prompts()).toBe(2);
    result('r2');
    expect(prompts()).toBe(2);
    expect(s.state.session.repeat).toBeNull();
    expect(s.state.events.some((e) => e.kind === 'system' && /^Loop finished at 01:51 after 1 round/.test(e.text))).toBe(true);
    vi.useRealTimers();
  });

  it('a round that fails waits before the next one', async () => {
    vi.useFakeTimers();
    const { s, result } = fakeSession();
    await s.prompt('/loop until 23:59 do the next round');
    result('r1', 'error_during_execution');
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: expect.stringMatching(/^Loop round 2 at \d\d:\d\d/) });
    vi.advanceTimersByTime(60_000);
    expect(s.state.events.filter((e) => e.kind === 'user')).toHaveLength(2);
    vi.advanceTimersByTime(61_000);
    expect(s.state.events.filter((e) => e.kind === 'user')).toHaveLength(3);
    result('r2');
    expect(s.state.events.filter((e) => e.kind === 'user')).toHaveLength(3);
    vi.advanceTimersByTime(2 * 60_000 + 1000);
    expect(s.state.events.filter((e) => e.kind === 'user')).toHaveLength(4);
    vi.useRealTimers();
  });

  it('resumeRepeat with a past nextAt fires the next round now', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 24, 3, 0, 0));
    const { s } = fakeSession();
    s.resumeRepeat({ prompt: 'do the next round', every: 10 * 60_000, until: null, round: 3, nextAt: Date.now() - 1000 });
    expect(s.state.events.map((e) => e.kind)).toEqual(['system', 'system', 'user']);
    expect(s.state.events[0]).toMatchObject({ kind: 'system', text: 'AgentView restarted, the loop continues every 10m' });
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'user', text: 'do the next round' });
    expect(s.state.session).toMatchObject({ running: true, repeat: { round: 4, nextAt: Date.now() + 10 * 60_000 } });
    vi.useRealTimers();
  });

  it('resumeRepeat with a future nextAt waits until then', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 24, 3, 0, 0));
    const { s, result } = fakeSession();
    const users = () => s.state.events.filter((e) => e.kind === 'user').length;
    s.resumeRepeat({ prompt: 'do the next round', every: 10 * 60_000, until: null, round: 3, nextAt: Date.now() + 5 * 60_000 });
    expect(users()).toBe(0);
    expect(s.state.session).toMatchObject({ running: false, repeat: { round: 3 } });
    vi.advanceTimersByTime(5 * 60_000 - 1);
    expect(users()).toBe(0);
    vi.advanceTimersByTime(1);
    expect(users()).toBe(1);
    expect(s.state.session.repeat?.round).toBe(4);
    result('r1');
    expect(users()).toBe(1);
    vi.advanceTimersByTime(10 * 60_000);
    expect(users()).toBe(2);
    vi.useRealTimers();
  });

  it('a tick that lands mid turn survives a CLI exit', async () => {
    vi.useFakeTimers();
    // Late in the evening the loop would reach its 23:59 end during the test.
    vi.setSystemTime(new Date('2026-10-15T12:00:00'));
    const { s, result } = fakeSession();
    await s.prompt('/loop 10m until 23:59 do the next round');
    vi.advanceTimersByTime(10 * 60_000 + 1);
    expect(s.state.events.filter((e) => e.kind === 'user')).toHaveLength(2);
    const priv = s.driver as unknown as { consume: () => Promise<void>; start: () => void };
    priv.consume();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.state.session.running).toBe(false);
    vi.spyOn(priv, 'start').mockImplementation(() => {});
    vi.advanceTimersByTime(2 * 60_000 + 1);
    expect(s.state.events.filter((e) => e.kind === 'user')).toHaveLength(3);
    vi.useRealTimers();
    result('r9');
  });
});

describe('/goal', () => {
  const CHECK = 'Check whether this goal is met: the tests pass. Reply GOAL MET when it is, otherwise keep working on it.';
  const users = (s: AgentSession) => s.state.events.filter((e) => e.kind === 'user').map((e) => e.kind === 'user' && e.text);
  const reply = (s: AgentSession, uuid: string, text: string) => (s.driver as unknown as { handle: (m: unknown) => void }).handle({ type: 'result', subtype: 'success', uuid, result: text, total_cost_usd: 0, is_error: false });

  it('sends the check when idle and stops on GOAL MET', async () => {
    vi.useFakeTimers();
    const { s } = fakeSession();
    await s.prompt('/goal the tests pass');
    expect(users(s)).toEqual(['/goal the tests pass', CHECK]);
    expect(s.state.session.repeat).toMatchObject({ goal: 'the tests pass', round: 1, every: 0, until: null });
    reply(s, 'r1', 'Two tests fail, fixing them');
    expect(s.state.session.running).toBe(false);
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: expect.stringMatching(/^Goal check 2 at \d\d:\d\d, \/goal off to end it$/) });
    vi.advanceTimersByTime(2 * 60_000 + 1);
    expect(users(s)).toHaveLength(3);
    expect(s.state.session.repeat?.round).toBe(2);
    reply(s, 'r2', 'All green. GOAL MET');
    expect(s.state.session.repeat).toBeNull();
    expect(users(s)).toHaveLength(3);
    expect(s.state.events.some((e) => e.kind === 'system' && e.text === 'Goal met after 2 checks: the tests pass')).toBe(true);
    vi.useRealTimers();
  });

  it('gives up after 20 checks, and /goal off ends it early', async () => {
    vi.useFakeTimers();
    const { s } = fakeSession();
    await s.prompt('/goal the build is green');
    for (let i = 1; i < 20; i++) {
      reply(s, `r${i}`, 'still red');
      vi.advanceTimersByTime(2 * 60_000 + 1);
      expect(s.state.session.repeat?.round).toBe(i + 1);
    }
    reply(s, 'r20', 'still red');
    expect(s.state.session.repeat).toBeNull();
    expect(users(s)).toHaveLength(21);
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: 'Goal not met after 20 checks: the build is green' });
    await s.prompt('/goal ship it');
    expect(s.state.session.repeat?.goal).toBe('ship it');
    await s.prompt('/goal off');
    expect(s.state.session.repeat).toBeNull();
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: 'Goal off' });
    expect(s.state.events.filter((e) => e.kind === 'system' && e.text === 'Goal on, checked whenever Claude goes idle until "ship it" is met, up to 20 checks')).toHaveLength(1);
    vi.useRealTimers();
  });
});

// A seeded random walk over the send paths. Run with FUZZ_SEEDS=500 to hammer it.
describe('send queue fuzz', () => {
  const seeds = Number(process.env.FUZZ_SEEDS ?? 40);
  const base = Number(process.env.FUZZ_FROM ?? 1);
  type Priv = { queued: unknown[]; enqueue: (text: string) => void };
  type Drv = { q: { interrupt: () => Promise<void> } | null; inputQueue: unknown[]; consume: () => Promise<void>; start: () => void };

  function rng(seed: number) {
    let x = seed * 2654435761 + 1;
    return () => ((x = (x ^ (x << 13)) >>> 0), (x = (x ^ (x >>> 17)) >>> 0), (x = (x ^ (x << 5)) >>> 0), x / 2 ** 32);
  }

  for (let seed = base; seed < base + seeds; seed++) {
    it(`seed ${seed}`, async () => {
      const r = rng(seed);
      const { s, interrupt, result } = fakeSession();
      const priv = s as unknown as Priv;
      const drv = s.driver as unknown as Drv;
      drv.start = () => {
        if (!drv.q) drv.q = { interrupt };
      };
      const sent: { id: string; text: string }[] = [];
      const dropped = new Set<string>();
      const started: string[] = [];
      const enqueue = priv.enqueue.bind(priv);
      priv.enqueue = (text: string) => {
        started.push(sent.find((m) => m.text === text)?.id ?? text);
        enqueue(text);
      };
      const idOf = (e: Extract<ChatEvent, { kind: 'user' }>) => sent.find((m) => m.id === e.id)?.id ?? e.text;
      const bigBro = () =>
        void (s.driver as unknown as { confirmBigBro: (i: unknown, sig: AbortSignal) => Promise<unknown> })
          .confirmBigBro({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: BIG_BRO, description: 'd', prompt: 'p' }, tool_use_id: `t${seed}-${n}` }, new AbortController().signal)
          .catch(() => {});
      let n = 0;
      const user = () => s.state.events.filter((e): e is Extract<ChatEvent, { kind: 'user' }> => e.kind === 'user');
      const trace: string[] = [];
      // Sent messages sit in the order Claude got them; waiting ones keep the order they were typed; nothing
      // is lost except what a Stop dropped, and a resend never doubles a message.
      const check = (op: string) => {
        trace.push(op);
        const info = () => `after ${trace.join(' > ')}`;
        const seen = user().map((e) => e.id);
        expect(new Set(seen).size, `duplicate user event ${info()}`).toBe(seen.length);
        expect(user().filter((e) => !e.queued).map(idOf), `sent order ${info()}`).toEqual(started);
        const waiting = sent.map((m) => m.id).filter((id) => !started.includes(id) && !dropped.has(id));
        expect(user().filter((e) => e.queued).map((e) => e.id), `queue order ${info()}`).toEqual(waiting);
        for (const e of user()) if (sent.some((m) => m.id === e.id)) expect(e.text, info()).toBe(sent.find((m) => m.id === e.id)?.text);
      };
      const queuedIds = () => (priv.queued as { id: string }[]).map((e) => e.id);
      for (let step = 0; step < 25; step++) {
        const roll = r();
        if (roll < 0.3) {
          const m = { id: `m${seed}-${++n}`, text: `msg ${n}` };
          sent.push(m);
          await s.prompt(m.text, m.id);
          check(`prompt ${m.id}`);
        } else if (roll < 0.5) {
          const m = { id: `m${seed}-${++n}`, text: `steer ${n}` };
          sent.push(m);
          await s.steer(m.text, m.id);
          check(`steer ${m.id}`);
        } else if (roll < 0.6 && sent.length) {
          const m = sent[Math.floor(r() * sent.length)];
          if (dropped.has(m.id)) continue;
          if (r() < 0.5) await s.prompt(m.text, m.id);
          else await s.steer(m.text, m.id);
          check(`resend ${m.id}`);
        } else if (roll < 0.7) {
          // The CLI has taken what was queued for it; a stop can now reach the running turn.
          if (r() < 0.5) drv.inputQueue = [];
          const q = s.state.session.running && !s.state.session.stopping ? queuedIds() : [];
          await s.interrupt();
          for (const id of q) dropped.add(id);
          check('interrupt');
        } else if (roll < 0.82) {
          // A turn only ends once every card is answered.
          if (s.state.session.running && !s.state.pending.length) result(`r${seed}-${step}`, r() < 0.3 ? 'error_during_execution' : 'success');
          check('result');
        } else if (roll < 0.87) {
          sent.push({ id: `c${seed}-${step}`, text: `/compact ${step}` });
          await s.prompt(`/compact ${step}`, `c${seed}-${step}`);
          check('compact');
        } else if (roll < 0.9) {
          // The CLI dies: queued input is lost, the events stay.
          drv.q = { ...drv.q, [Symbol.asyncIterator]: async function* () {} } as unknown as Drv['q'];
          await drv.consume();
          check('exit');
          expect(s.state.pending, `cards survived a CLI exit: ${trace.join(' > ')}`).toHaveLength(0);
        } else if (roll < 0.94) {
          if (s.state.session.running && !s.state.pending.length) bigBro();
          check('ask');
        } else if (roll < 0.97) {
          const card = s.state.pending[0];
          if (card) s.answerPermission(card.id, r() < 0.5);
          check('answer');
        } else {
          s.changePlan([`step ${step}`, 'then stop']);
          check('plan');
        }
      }
      for (let i = 0; i < 60 && (s.state.session.running || s.state.pending.length); i++) {
        for (const card of s.state.pending) s.answerPermission(card.id, false);
        if (s.state.session.running) result(`drain${i}`);
      }
      expect(s.state.pending, `cards left after draining: ${trace.join(' > ')}`).toHaveLength(0);
      expect(s.state.session.running, `still running after draining: ${trace.join(' > ')}`).toBe(false);
      expect(user().some((e) => e.queued), `queue not empty after draining: ${trace.join(' > ')}`).toBe(false);
    });
  }
});

describe('rewind files', () => {
  it('rewinds to the uuid the CLI echoed for the prompt, or the history id', async () => {
    const { s, result } = fakeSession();
    const rewindFiles = vi.fn(async () => ({ canRewind: true, filesChanged: ['/tmp/project/a.ts'] }));
    Object.assign(s.driver, { q: { interrupt: vi.fn(), rewindFiles } });
    const handle = (msg: unknown) => (s.driver as unknown as { handle: (m: unknown) => void }).handle(msg);
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
    const { s } = fakeSession();
    const handle = (msg: unknown) => (s.driver as unknown as { handle: (m: unknown) => void }).handle(msg);
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
