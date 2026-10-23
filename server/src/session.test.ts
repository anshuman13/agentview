import { afterAll, describe, expect, it, vi } from 'vitest';
import { appendFileSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AgentSession, BIG_BRO, fireTime } from './session.js';
import { JsonlTail } from './tail.js';
import { contextFrom, historyFrom } from './transcript.js';
import type { ChatEvent, ServerMessage } from '../../shared/protocol.js';

const CLAUDE_DIR = vi.hoisted(() => (process.env.CLAUDE_CONFIG_DIR = `${process.env.TMPDIR ?? '/tmp'}/agentview-test-${process.pid}`));

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

describe('AgentSession delivery', () => {
  const internals = (s: AgentSession) => s as unknown as { q: unknown; consume: () => Promise<void>; inputStream: (gen: number) => AsyncGenerator<unknown>; gen: number };

  it('clears a dead Claude process and resends the prompt it never took', async () => {
    vi.useFakeTimers();
    try {
      const s = new AgentSession('/tmp/project');
      const start = vi.spyOn(s, 'start').mockImplementation(() => {});
      internals(s).q = { interrupt: vi.fn(), async *[Symbol.asyncIterator]() { throw new Error('claude exited'); } };
      s.sendPrompt('hello');
      await internals(s).consume();
      expect(internals(s).q).toBeNull();
      expect(s.state.session.running).toBe(false);
      vi.advanceTimersByTime(1000);
      expect(start).toHaveBeenCalled();
      expect(s.state.session.running).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts a fresh process for the next prompt after the old one died with nothing waiting', async () => {
    const s = new AgentSession('/tmp/project');
    const start = vi.spyOn(s, 'start').mockImplementation(() => {});
    internals(s).q = { interrupt: vi.fn(), async *[Symbol.asyncIterator]() {} };
    await internals(s).consume();
    start.mockClear();
    await s.prompt('are you there');
    expect(start).toHaveBeenCalledOnce();
    expect(s.state.session.running).toBe(true);
  });

  it('an old process ending does not stop a newer turn', async () => {
    const s = new AgentSession('/tmp/project');
    vi.spyOn(s, 'start').mockImplementation(() => {});
    let end = () => {};
    const gate = new Promise<void>((r) => (end = r));
    internals(s).q = { interrupt: vi.fn(), async *[Symbol.asyncIterator]() { await gate; } };
    const done = internals(s).consume();
    internals(s).q = { interrupt: vi.fn() };
    s.sendPrompt('new turn');
    end();
    await done;
    expect(s.state.session.running).toBe(true);
  });

  it('sends a queued prompt when the Claude process dies mid-turn', async () => {
    const s = new AgentSession('/tmp/project');
    const start = vi.spyOn(s, 'start').mockImplementation(() => {});
    internals(s).q = { interrupt: vi.fn(), async *[Symbol.asyncIterator]() {} };
    s.sendPrompt('long task');
    (s as unknown as { inputQueue: unknown[] }).inputQueue = [];
    await s.prompt('queued meanwhile', 'c9');
    expect(s.state.events.at(-1)).toMatchObject({ id: 'c9', queued: true });
    await internals(s).consume();
    expect(start).toHaveBeenCalled();
    expect(s.state.events.find((e) => e.id === 'c9')).toMatchObject({ queued: false });
    expect(s.waiting).toBe(1);
  });

  it('Stop with no Claude process discards what was kept for a restart', async () => {
    const s = new AgentSession('/tmp/project');
    vi.spyOn(s, 'start').mockImplementation(() => {});
    const delivered = vi.fn();
    s.onDelivered = delivered;
    s.sendPrompt('kept', 'c8');
    await s.interrupt();
    expect(delivered).toHaveBeenCalledWith('c8');
    expect(s.waiting).toBe(0);
  });

  it('reports a prompt as delivered when it is handed to Claude', async () => {
    const s = new AgentSession('/tmp/project');
    vi.spyOn(s, 'start').mockImplementation(() => {});
    internals(s).q = { interrupt: vi.fn() };
    const delivered = vi.fn();
    s.onDelivered = delivered;
    s.sendPrompt('hello', 'c1');
    expect(s.state.events.at(-1)).toMatchObject({ id: 'c1', text: 'hello' });
    await internals(s).inputStream(internals(s).gen).next();
    expect(delivered).toHaveBeenCalledWith('c1');
  });

  it('Stop says which queued messages it discarded', async () => {
    const { s } = fakeSession();
    const delivered = vi.fn();
    s.onDelivered = delivered;
    s.sendPrompt('task');
    await s.prompt('next thing', 'c2');
    await s.interrupt();
    expect(delivered).toHaveBeenCalledWith('c2');
    expect(s.state.events.some((e) => e.kind === 'user' && e.id === 'c2')).toBe(false);
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'system', text: expect.stringContaining('next thing') });
  });

  it('shows the prompt before switching to plan mode, and still sends it when the switch fails', async () => {
    const { s } = fakeSession();
    Object.assign(s.state.session, { team: true, permissionMode: 'auto' });
    vi.spyOn(s, 'setPermissionMode').mockRejectedValue(new Error('control request timed out'));
    const sent = s.prompt('plan this', 'c3');
    expect(s.state.events.at(-1)).toMatchObject({ id: 'c3', text: 'plan this' });
    await sent;
    expect(s.state.session.running).toBe(true);
    expect(s.state.events.some((e) => e.kind === 'system' && e.text.includes('plan mode'))).toBe(true);
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

describe('transcript sync', () => {
  const cwd = '/tmp/agentview-sync';
  const dir = path.join(CLAUDE_DIR, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  let n = 0;
  const line = (sessionId: string, type: 'user' | 'assistant', text: string, parent: string | null) => {
    const uuid = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
    const message = type === 'user' ? { role: 'user', content: text } : { role: 'assistant', content: [{ type: 'text', text }] };
    return { uuid, text: JSON.stringify({ type, uuid, parentUuid: parent, sessionId, cwd, isSidechain: false, timestamp: new Date(1_800_000_000_000 + n * 1000).toISOString(), message }) + '\n' };
  };
  afterAll(() => rmSync(CLAUDE_DIR, { recursive: true, force: true }));
  const texts = (s: AgentSession) => s.state.events.flatMap((e) => (e.kind === 'user' || e.kind === 'assistant' ? [e.text] : []));
  async function setup() {
    mkdirSync(dir, { recursive: true });
    const sessionId = `11111111-2222-4333-8444-${String(++n).padStart(12, '0')}`;
    const file = path.join(dir, `${sessionId}.jsonl`);
    const a = line(sessionId, 'user', 'hello', null);
    const b = line(sessionId, 'assistant', 'hi there', a.uuid);
    writeFileSync(file, a.text + b.text);
    const s = new AgentSession(cwd, sessionId);
    await s.loadHistory();
    const sent: ServerMessage[] = [];
    s.onMessage((m) => sent.push(m));
    const sync = () => (s as unknown as { syncTranscript: (own: boolean) => Promise<void> }).syncTranscript(false);
    return { s, sessionId, file, last: b.uuid, sent, sync };
  }

  it('parses only appended lines and pushes the new history', async () => {
    const { s, sessionId, file, last, sent, sync } = await setup();
    expect(texts(s)).toEqual(['hello', 'hi there']);
    const parse = vi.spyOn(JSON, 'parse');
    const c = line(sessionId, 'user', 'next', last);
    const d = line(sessionId, 'assistant', 'done', c.uuid);
    appendFileSync(file, c.text + d.text.slice(0, 20));
    await sync();
    appendFileSync(file, d.text.slice(20));
    await sync();
    const lines = parse.mock.calls.filter(([t]) => typeof t === 'string' && t.includes('"sessionId"'));
    parse.mockRestore();
    expect(lines.map(([t]) => JSON.parse(t as string).uuid)).toEqual([c.uuid, d.uuid]);
    expect(texts(s)).toEqual(['hello', 'hi there', 'next', 'done']);
    expect(sent.filter((m) => m.type === 'init')).toHaveLength(2);
  });

  it('emits nothing when the transcript did not change', async () => {
    const { sent, sync } = await setup();
    await sync();
    await sync();
    expect(sent).toEqual([]);
  });

  it('reloads in full when the file shrank or was replaced', async () => {
    const { s, sessionId, file, sync } = await setup();
    const a = line(sessionId, 'user', 'other', null);
    writeFileSync(file, a.text);
    await sync();
    expect(texts(s)).toEqual(['other']);
    const b = line(sessionId, 'assistant', 'replaced', a.uuid);
    writeFileSync(`${file}.tmp`, a.text + b.text);
    renameSync(`${file}.tmp`, file);
    await sync();
    expect(texts(s)).toEqual(['other', 'replaced']);
  });

  it('JsonlTail reports appends, partial lines and rewrites', async () => {
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `tail-${++n}.jsonl`);
    writeFileSync(file, '{"a":1}\n{"a":2}\n');
    const t = new JsonlTail(file);
    expect(await t.read()).toBe('reload');
    expect(await t.read()).toBe('same');
    appendFileSync(file, '{"a":3}\n{"a"');
    expect(await t.read()).toBe('append');
    appendFileSync(file, ':4}\n');
    expect(await Promise.all([t.read(), t.read()])).toEqual(['append', 'same']);
    expect(t.entries).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }]);
    writeFileSync(file, '{"b":1}\n{"a":2}\n{"a":3}\n{"a":4}\n{"a":5}\n');
    expect(await t.read()).toBe('reload');
    expect(t.entries).toEqual([{ b: 1 }, { a: 2 }, { a: 3 }, { a: 4 }, { a: 5 }]);
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

  it('keeps the full agent report and caps other tool results', () => {
    const { s } = fakeSession();
    const handle = (msg: unknown) => (s as unknown as { handle: (m: unknown) => void }).handle(msg);
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
    const handle = (msg: unknown) => (s as unknown as { handle: (m: unknown) => void }).handle(msg);
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
    const s = new AgentSession('/tmp/project');
    const apply = () => (s as unknown as { applyHistory: (m: unknown[], subs: object) => ChatEvent[] }).applyHistory(history, {});
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
    const handle = (msg: unknown) => (s as unknown as { handle: (m: unknown) => void }).handle(msg);
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

  it('forwards subagent text live and from history', () => {
    const { s } = fakeSession();
    const handle = (msg: unknown) => (s as unknown as { handle: (m: unknown) => void }).handle(msg);
    handle({ type: 'assistant', parent_tool_use_id: 'ag', message: { content: [{ type: 'text', text: 'Looking around' }] } });
    expect(s.state.events.at(-1)).toMatchObject({ kind: 'assistant', text: 'Looking around', parent: 'ag' });
    const msg = (type: string, content: unknown) => ({ type, uuid: 'u', session_id: 's', parent_tool_use_id: null, timestamp: '2026-10-15T10:00:00Z', message: { content } }) as never;
    const { events } = historyFrom([msg('user', 'survey')], { ag: [msg('assistant', [{ type: 'text', text: 'Looking around' }])] });
    expect(events.filter((e) => e.kind === 'assistant')).toMatchObject([{ text: 'Looking around', parent: 'ag' }]);
  });

  it('uses the hand-back report', () => {
    const { s } = fakeSession();
    const handle = (msg: unknown) => (s as unknown as { handle: (m: unknown) => void }).handle(msg);
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
