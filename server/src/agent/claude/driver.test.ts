import { describe, expect, it, vi } from 'vitest';
import { appendFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentSession } from '../../session/session.js';
import type { CanUseTool, HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { claudeSession } from './driver.js';
import { agentOptions } from './options.js';
import { unattendedRules, type Unattended } from '../../session/unattended.js';
import { workflowAgents } from './history.js';
import { JsonlTail } from './tail.js';
import { contextFrom, historyFrom } from './transcript.js';
import type { ServerMessage } from '../../../../shared/protocol.js';

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR!;

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
  const texts = (s: AgentSession) => s.state.events.flatMap((e) => (e.kind === 'user' || e.kind === 'assistant' ? [e.text] : []));
  async function setup() {
    mkdirSync(dir, { recursive: true });
    const sessionId = `11111111-2222-4333-8444-${String(++n).padStart(12, '0')}`;
    const file = path.join(dir, `${sessionId}.jsonl`);
    const a = line(sessionId, 'user', 'hello', null);
    const b = line(sessionId, 'assistant', 'hi there', a.uuid);
    writeFileSync(file, a.text + b.text);
    const s = claudeSession(cwd, sessionId);
    await s.loadHistory();
    const sent: ServerMessage[] = [];
    s.onMessage((m) => sent.push(m));
    const sync = () => (s.driver as unknown as { watcher: { syncTranscript: (own: boolean) => Promise<void> } }).watcher.syncTranscript(false);
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

  it('shows workflow agents live with an open query, once each, without releasing queued messages', async () => {
    const { s, sessionId, sent } = await setup();
    const owner = s.driver as unknown as { q: object | null; watcher: { syncWorkflows: () => Promise<void> } };
    owner.q = {};
    const sync = () => owner.watcher.syncWorkflows();
    const release = vi.spyOn(s.waiting, 'release');
    const wf = path.join(dir, sessionId, 'subagents', 'workflows', 'wf_live');
    const journal = path.join(wf, 'journal.jsonl');
    const stepId = (e: { kind: string }) => e.kind === 'tool_result' && 'toolUseId' in e && e.toolUseId === 't1';
    await sync();
    expect(sent).toEqual([]);
    mkdirSync(wf, { recursive: true });
    writeFileSync(journal, JSON.stringify({ type: 'started', key: 'k1', agentId: 'a1', label: 'impl', phase: 'build' }) + '\n');
    await sync();
    expect(sent).toEqual([]);
    s.pushEvent({ id: 'w1', kind: 'tool_use', name: 'Workflow', input: { name: 'ship' }, summary: '', at: 1 });
    s.pushEvent({ id: 'w1:r', kind: 'tool_result', toolUseId: 'w1', text: 'Started.\nRun ID: wf_live', isError: false, at: 2 });
    sent.length = 0;
    release.mockClear();
    await sync();
    expect(sent.filter((m) => m.type === 'init')).toEqual([]);
    expect(sent.map((m) => m.type === 'event' && m.event.id)).toEqual(['wf_live:k1', 'wf_live:k1:agent']);
    expect(s.eventById('wf_live:k1:agent')).toMatchObject({ status: 'running', group: 'ship' });
    const step = { type: 'user', uuid: 'u-step', timestamp: new Date(1_800_000_100_000).toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } };
    writeFileSync(path.join(wf, 'agent-a1.jsonl'), JSON.stringify(step) + '\n');
    appendFileSync(journal, JSON.stringify({ type: 'result', key: 'k1', agentId: 'a1', result: 'Built' }) + '\n');
    sent.length = 0;
    await sync();
    const ids = sent.map((m) => m.type === 'event' && m.event.id);
    expect(ids).toEqual(expect.arrayContaining(['wf_live:k1:agent', 'wf_live:k1:result', 'u-step:0']));
    expect(s.eventById('wf_live:k1:agent')).toMatchObject({ status: 'done' });
    expect(release).not.toHaveBeenCalled();
    sent.length = 0;
    await sync();
    expect(sent).toEqual([]);
    expect(s.state.events.filter(stepId)).toHaveLength(1);
    const { runs } = await workflowAgents(cwd, sessionId);
    const msg = (uuid: string, type: string, content: unknown) => ({ type, uuid, session_id: 's', parent_tool_use_id: null, timestamp: new Date(1_800_000_000_000).toISOString(), message: { content } }) as never;
    const rebuilt = historyFrom([msg('a', 'assistant', [{ type: 'tool_use', id: 'w1', name: 'Workflow', input: { name: 'ship' } }]), msg('r', 'user', [{ type: 'tool_result', tool_use_id: 'w1', content: 'Run ID: wf_live' }])], {}, runs).events;
    expect(rebuilt.filter(stepId).map((e) => e.id)).toEqual(['u-step:0']);
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

describe('agentOptions unattended', () => {
  const rules = unattendedRules('/w/job', { allowWrite: ['/extra'], allowedDomains: ['pypi.org'] }, ['/home/x/.claude-alt']);
  const build = (unattended?: Unattended) => agentOptions({ cwd: '/w/job', host: { setStatus: vi.fn() }, chat: () => null, canUseTool: vi.fn() as unknown as CanUseTool, beforeAgent: vi.fn() as unknown as HookCallback, beforeEdit: vi.fn() as unknown as HookCallback, beforeTool: vi.fn() as unknown as HookCallback, afterTool: vi.fn() as unknown as HookCallback, onStop: vi.fn() as unknown as HookCallback, unattended });

  it('disallows git push and gh only for an unattended chat', () => {
    expect(build(rules).disallowedTools).toEqual(expect.arrayContaining(['Bash(git push:*)', 'Bash(gh:*)']));
    expect(build().disallowedTools).not.toContain('Bash(gh:*)');
  });

  it('holds the sandbox, with no Chrome, only for an unattended chat', () => {
    const o = build(rules);
    expect(o.sandbox).toMatchObject({
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      filesystem: { allowWrite: ['/w/job', os.tmpdir(), '/extra'], denyWrite: ['/w/job/.git'] },
      network: { allowedDomains: ['pypi.org'] },
    });
    expect(o.sandbox?.filesystem?.denyRead).toEqual(expect.arrayContaining([path.join(os.homedir(), '.ssh'), path.join(os.homedir(), '.agentview'), path.join(os.homedir(), '.claude'), '/home/x/.claude-alt']));
    expect(o.extraArgs).not.toHaveProperty('chrome');
    expect(o.mcpServers).not.toHaveProperty('browser');
    expect(build().sandbox).toBeUndefined();
    expect(build().extraArgs).toHaveProperty('chrome');
  });
});
