import { describe, expect, it, vi } from 'vitest';
import { AgentSession, BIG_BRO, fireTime } from './session.js';
import { contextFrom, historyFrom } from './transcript.js';

function fakeSession() {
  const s = new AgentSession('/tmp/project');
  const interrupt = vi.fn(async () => {});
  Object.assign(s, { q: { interrupt } });
  const handle = (msg: unknown) => (s as unknown as { handle: (m: unknown) => void }).handle(msg);
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
    Object.assign(s, { inputQueue: [] });
    await s.interrupt();
    expect(interrupt).toHaveBeenCalledOnce();
    expect(s.state.session.stopping).toBe(true);
    result('r1', 'error_during_execution');
    expect(s.state.session).toMatchObject({ running: false, stopping: false });
  });

  it('does not auto-compact after a stop', async () => {
    const { s, result } = fakeSession();
    s.sendPrompt('big task');
    Object.assign(s, { inputQueue: [] });
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
});

describe('Fable approval', () => {
  const call = (s: AgentSession, subagent_type: string) =>
    (s as unknown as { confirmBigBro: (i: unknown, sig: AbortSignal) => Promise<any> }).confirmBigBro(
      { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type, description: 'race condition', prompt: 'why?' }, tool_use_id: 't1' },
      new AbortController().signal,
    );

  it('lets other agents through untouched', async () => {
    expect(await call(new AgentSession('/tmp/p'), 'Explore')).toEqual({});
  });

  it('waits for the user and allows when approved', async () => {
    const s = new AgentSession('/tmp/p');
    const decision = call(s, BIG_BRO);
    const req = s.state.pending[0];
    expect(req).toMatchObject({ kind: 'permission', title: 'Ask Fable: race condition', canAlwaysAllow: false });
    s.answerPermission(req.id, true);
    expect((await decision).hookSpecificOutput.permissionDecision).toBe('allow');
  });

  it('denies when the user declines', async () => {
    const s = new AgentSession('/tmp/p');
    const decision = call(s, BIG_BRO);
    s.answerPermission(s.state.pending[0].id, false);
    expect((await decision).hookSpecificOutput).toMatchObject({ permissionDecision: 'deny' });
  });
});

describe('Team mode', () => {
  function teamSession() {
    const s = new AgentSession('/tmp/p');
    const q = { interrupt: vi.fn(async () => {}), setModel: vi.fn(async () => {}), setPermissionMode: vi.fn(async () => {}), applyFlagSettings: vi.fn(async () => {}) };
    Object.assign(s, { q });
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
    const s = new AgentSession('/repo');
    const handle = (m: unknown) => (s as unknown as { handle: (m: unknown) => void }).handle(m);
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
    const out = s.afterTool(hook) as { hookSpecificOutput?: { additionalContext?: string } };
    expect(out.hookSpecificOutput?.additionalContext).toContain('1. curl /check\n2. stop the server');
    expect(s.afterTool(hook)).toEqual({});
  });

  it('skips sub-agent tool calls', () => {
    const { s } = fakeSession();
    s.sendPrompt('task');
    s.changePlan(['a']);
    expect(s.afterTool({ ...(hook as object), agent_id: 'sub' } as never)).toEqual({});
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
    const text = () => (s.afterTool(hook) as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput?.additionalContext;
    for (let i = 0; i < 7; i++) expect(text()).toBeUndefined();
    expect(text()).toContain('set_status');
    s.afterTool({ ...(hook as object), tool_name: 'mcp__agentview__set_status' } as never);
    for (let i = 0; i < 7; i++) expect(text()).toBeUndefined();
  });

  it('sends right away when idle', () => {
    const { s } = fakeSession();
    s.changePlan([]);
    expect(s.state.session.running).toBe(true);
  });
});

describe('context tokens', () => {
  it('adds fresh, cached and newly cached input tokens', () => {
    expect(contextFrom({ input_tokens: 10, cache_read_input_tokens: 200_000, cache_creation_input_tokens: 5_000 })).toBe(205_010);
    expect(contextFrom({ input_tokens: 0 })).toBeNull();
    expect(contextFrom(undefined)).toBeNull();
  });
});

describe('history', () => {
  const msg = (type: string, content: unknown, extra: object = {}) => ({ type, uuid: 'u', session_id: 's', parent_tool_use_id: null, timestamp: '2026-10-15T10:00:00Z', message: { content, ...extra } }) as never;

  it('rebuilds turns, tool calls and the context size', () => {
    const { events, context } = historyFrom([
      msg('user', 'fix the bug'),
      msg('assistant', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }], { usage: { input_tokens: 5, cache_read_input_tokens: 1000 } }),
      msg('user', [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]),
      msg('assistant', [{ type: 'text', text: 'Fixed' }]),
      msg('user', '[Request interrupted by user]'),
    ]);
    expect(events.map((e) => e.kind)).toEqual(['user', 'tool_use', 'tool_result', 'assistant', 'system', 'result']);
    expect(events[1]).toMatchObject({ summary: '$ npm test' });
    expect(events.at(-1)).toMatchObject({ text: 'Fixed' });
    expect(context).toBe(1005);
  });
});

describe('subagents', () => {
  const launched = 'Async agent launched successfully.\nagentId: a1';

  it('keeps a background agent running until its notification and tags its steps', () => {
    const { s } = fakeSession();
    const handle = (msg: unknown) => (s as unknown as { handle: (m: unknown) => void }).handle(msg);
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
});

describe('compacting', () => {
  it('shows compacting from /compact until the boundary arrives', () => {
    const { s } = fakeSession();
    const handle = (msg: unknown) => (s as unknown as { handle: (m: unknown) => void }).handle(msg);
    s.sendPrompt('/compact');
    expect(s.state.session.compacting).toBe(true);
    expect(s.state.status).toBe('Compacting the conversation');
    handle({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'manual', pre_tokens: 295_000, post_tokens: 12_000 } });
    expect(s.state.session.compacting).toBe(false);
    expect(s.state.session.context).toBe(12_000);
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
    const handle = (msg: unknown) => (s as unknown as { handle: (m: unknown) => void }).handle(msg);
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
