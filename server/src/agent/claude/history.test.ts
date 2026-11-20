import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

const config = await mkdtemp(path.join(os.tmpdir(), 'av-wf-'));
process.env.CLAUDE_CONFIG_DIR = config;
const { parseJournal, projectDir, sessionMessages, subagentMessages, workflowAgents, workflowSize } = await import('./history.js');
const { historyFrom, workflowEvents, workflowName } = await import('./transcript.js');

const lines = (...l: unknown[]) => l.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n');
const started = (key: string, agentId: string, label = key) => ({ type: 'started', key, agentId, label, phase: 'Build' });

describe('parseJournal', () => {
  it('opens, closes and fails agents', () => {
    const text = lines({ type: 'launched' }, started('k1', 'a1', 'one'), started('k2', 'a2'), { type: 'result', key: 'k2', agentId: 'a2', result: 'ok' }, started('k3', 'a3'), { type: 'failed', key: 'k3', agentId: 'a3' });
    expect(parseJournal(text).map((a) => [a.key, a.label, a.status, a.result])).toEqual([['k1', 'one', 'running', ''], ['k2', 'k2', 'done', 'ok'], ['k3', 'k3', 'failed', '']]);
  });

  it('keeps the latest started for a repeated key, ignores a lone result and a cut last line', () => {
    const text = lines(started('k1', 'a1', 'old'), { type: 'result', key: 'k1', result: 'x' }, started('k1', 'a9', 'new'), { type: 'result', key: 'nope', result: 'x' }, '{"type":"started","key":"k4","ag');
    expect(parseJournal(text)).toEqual([{ key: 'k1', agentId: 'a9', label: 'new', phase: 'Build', status: 'running', result: '' }]);
  });

  it('marks a result that reports an error as failed', () => {
    expect(parseJournal(lines(started('k1', 'a1'), { type: 'result', key: 'k1', error: 'boom' }))[0].status).toBe('failed');
  });

  it('keeps an object result as JSON and a long result whole in the chat events', () => {
    const verdict = { verdict: 'pass', report: 'x'.repeat(5000), fixes: [] };
    const [a] = parseJournal(lines(started('k1', 'a1', 'test:tin-can#1'), { type: 'result', key: 'k1', result: verdict }));
    expect(JSON.parse(a.result)).toEqual(verdict);
    const events = workflowEvents({ runId: 'wf_y', agents: [{ ...a, msgs: [] }] }, 'build', 1);
    expect(events.find((e) => e.kind === 'tool_result')).toMatchObject({ text: a.result });
  });
});

describe('workflow runs', () => {
  const cwd = '/tmp/proj';
  const sessionId = 's1';
  const entry = (type: string, uuid: string, content: unknown, usage?: unknown) => ({ type, uuid, timestamp: '2026-10-15T10:00:00Z', message: { content, usage } });
  const dir = () => path.join(projectDir(cwd), sessionId, 'subagents', 'workflows', 'wf_x');

  beforeAll(async () => {
    await mkdir(dir(), { recursive: true });
    await writeFile(path.join(dir(), 'journal.jsonl'), lines({ type: 'launched' }, started('k1', 'a1', 'impl:chat'), { type: 'result', key: 'k1', agentId: 'a1', result: 'Built it' }, started('k2', 'a2', 'impl:tab'), '{"type":"res'));
    await writeFile(path.join(dir(), 'agent-a1.jsonl'), lines(entry('user', 'u1', 'Do it'), entry('assistant', 'm1', [{ type: 'text', text: 'working' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }], { input_tokens: 100, output_tokens: 20 })));
    await writeFile(path.join(dir(), 'agent-a2.jsonl'), 'not json');
  });
  afterAll(() => rm(config, { recursive: true, force: true }));

  it('reads one run, skips bad files, and re-reads nothing when unchanged', async () => {
    const cache = new Map();
    const first = await workflowAgents(cwd, sessionId, cache);
    expect(first.changed).toBe(true);
    expect(first.runs.map((r) => r.runId)).toEqual(['wf_x']);
    expect(first.runs[0].agents.map((a) => [a.label, a.status, a.msgs.length])).toEqual([['impl:chat', 'done', 2], ['impl:tab', 'running', 0]]);
    expect(workflowSize(first.runs)).toBeGreaterThan(0);
    expect((await workflowAgents(cwd, sessionId, cache)).changed).toBe(false);
    expect((await workflowAgents('/tmp/none', sessionId)).runs).toEqual([]);
  });

  it('stops the open agents of a run that ended, and keeps them running while it runs', async () => {
    const record = path.join(projectDir(cwd), sessionId, 'workflows', 'wf_x.json');
    await mkdir(path.dirname(record), { recursive: true });
    await writeFile(record, JSON.stringify({ status: 'running' }));
    expect((await workflowAgents(cwd, sessionId)).runs[0].agents.map((a) => a.status)).toEqual(['done', 'running']);
    await writeFile(record, JSON.stringify({ status: 'killed' }));
    expect((await workflowAgents(cwd, sessionId)).runs[0].agents.map((a) => a.status)).toEqual(['done', 'stopped']);
    await rm(record);
  });

  it('links a run to its call by the Run ID and ignores an unmatched run', async () => {
    const { runs } = await workflowAgents(cwd, sessionId);
    const msg = (uuid: string, type: string, content: unknown) => ({ type, uuid, session_id: 's', parent_tool_use_id: null, timestamp: '2026-10-15T10:00:00Z', message: { content } }) as never;
    const msgs = [msg('u', 'user', 'go'), msg('a', 'assistant', [{ type: 'tool_use', id: 'w1', name: 'Workflow', input: { name: 'build' } }]), msg('r', 'user', [{ type: 'tool_result', tool_use_id: 'w1', content: 'Started.\nRun ID: wf_x' }])];
    const events = historyFrom(msgs, {}, runs).events;
    const agents = events.filter((e) => e.kind === 'agent');
    expect(agents.map((e) => e.kind === 'agent' && [e.description, e.group, e.status, e.usage?.tokens])).toEqual([['impl:chat', 'build', 'done', 120], ['impl:tab', 'build', 'running', undefined]]);
    expect(events.some((e) => e.kind === 'assistant' && e.parent === 'wf_x:k1')).toBe(true);
    const other = [msgs[0], msgs[1], msg('r2', 'user', [{ type: 'tool_result', tool_use_id: 'w1', content: 'Run ID: wf_other' }])];
    expect(historyFrom(other, {}, runs).events.filter((e) => e.kind === 'agent')).toEqual([]);
  });

  it('names the group from the call input', () => {
    expect(workflowName({ name: 'build' })).toBe('build');
    expect(workflowName({ workflow: 'ship' })).toBe('ship');
    expect(workflowName({ scriptPath: '/a/.claude/workflows/native.js' })).toBe('native');
    expect(workflowName({ script: "export const meta = { name: 'batch-ab', description: 'x' }" })).toBe('batch-ab');
    expect(workflowName({})).toBe('Workflow');
  });
});

describe('a Write to a memory file', () => {
  it('gives the events in shared/fixtures/remembered-history.json, which the clients fold into Remembered', async () => {
    const file = '/Users/x/.claude-alt/projects/-Users-x-repo/memory/prefs.md';
    const msg = (uuid: string, type: string, content: unknown) => ({ type, uuid, session_id: 's', parent_tool_use_id: null, timestamp: '2026-10-15T10:00:00Z', message: { content } }) as never;
    const msgs = [
      msg('u1', 'user', 'remember that I prefer short replies'),
      msg('a1', 'assistant', [{ type: 'tool_use', id: 'w1', name: 'Write', input: { file_path: file, content: 'Prefers short replies.' } }]),
      msg('u2', 'user', [{ type: 'tool_result', tool_use_id: 'w1', content: `File created successfully at: ${file}` }]),
      msg('a2', 'assistant', [{ type: 'text', text: 'Saved.' }]),
    ];
    const fixture = JSON.parse(await readFile(new URL('../../../../shared/fixtures/remembered-history.json', import.meta.url), 'utf8'));
    expect(historyFrom(msgs).events).toEqual(fixture);
  });
});

describe('sessionMessages', () => {
  const sid = '11111111-2222-4333-8444-000000000001';
  const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const e = (n: number, type: string, parent: number | null, extra: object = {}) => ({ type, uuid: u(n), parentUuid: parent && u(parent), sessionId: sid, isSidechain: false, timestamp: new Date(1_800_000_000_000 + n * 1000).toISOString(), message: type === 'user' ? { role: 'user', content: `m${n}` } : { role: 'assistant', content: [{ type: 'text', text: `m${n}` }] }, ...extra });

  it('keeps the conversation from before a compaction', async () => {
    const entries = [e(1, 'user', null), e(2, 'assistant', 1), e(3, 'system', null, { subtype: 'compact_boundary', logicalParentUuid: u(2), message: undefined }), e(4, 'user', 3), e(5, 'assistant', 4)];
    const msgs = await sessionMessages(sid, '/tmp', entries);
    expect(msgs.map((m) => m.uuid)).toEqual([u(1), u(2), ...msgs.slice(2).map((m) => m.uuid)]);
    expect(msgs.at(-1)?.uuid).toBe(u(5));
  });

  it('puts back a task notification the CLI saved as an attachment', async () => {
    const att = (n: number, parent: number, prompt: string) => ({ ...e(n, 'attachment', parent), message: undefined, attachment: { type: 'queued_command', prompt } });
    const entries = [e(1, 'user', null), e(2, 'assistant', 1), att(3, 2, '<agent-message from="a1">hi</agent-message>'), att(4, 3, '<task-notification><status>completed</status></task-notification>'), e(5, 'user', 2)];
    const msgs = await sessionMessages(sid, '/tmp', entries);
    expect(msgs.map((m) => m.uuid)).toEqual([u(1), u(2), u(4), u(5)]);
    expect(msgs[2]).toMatchObject({ type: 'user', message: { content: '<task-notification><status>completed</status></task-notification>' } });
  });

});

describe('historyFrom sub-agents', () => {
  const msg = (uuid: string, type: string, content: unknown) => ({ type, uuid, session_id: 's', parent_tool_use_id: null, timestamp: '2026-10-15T10:00:00Z', message: { content } }) as never;
  const call = (uuid: string, id: string) => msg(uuid, 'assistant', [{ type: 'tool_use', id, name: 'Agent', input: { description: `agent ${id}` } }]);
  const done = (uuid: string, id: string) => msg(uuid, 'user', [{ type: 'tool_result', tool_use_id: id, content: 'done' }]);
  const step = (uuid: string, text: string) => msg(uuid, 'assistant', [{ type: 'text', text }]);
  const order = (events: { kind: string; id: string; text?: string; parent?: string }[]) =>
    events.map((e) => (e.kind === 'assistant' ? `${e.parent ?? 'main'}:${e.text}` : e.kind === 'user' || e.kind === 'result' ? e.kind : `${e.kind}:${e.id}`));

  it('puts each sub-agent after its own call and the reply last', () => {
    const main = [msg('u', 'user', 'go'), call('c1', 'a1'), done('r1', 'a1'), call('c2', 'a2'), done('r2', 'a2'), step('m', 'reply')];
    const subs = { a1: [step('s1', 'one'), step('s2', 'two')], a2: [step('s3', 'three')] };
    expect(order(historyFrom(main, subs).events as never)).toEqual([
      'user', 'tool_use:a1', 'agent:a1:agent', 'a1:one', 'a1:two', 'tool_result:r1:0',
      'tool_use:a2', 'agent:a2:agent', 'a2:three', 'tool_result:r2:0', 'main:reply', 'result',
    ]);
  });

  it('puts a nested sub-agent after its call inside its parent, and an unmatched one at the end', () => {
    const main = [msg('u', 'user', 'go'), call('c1', 'a1'), done('r1', 'a1')];
    const subs = { orphanChild: [step('s5', 'deep')], b1: [step('s3', 'inner')], a1: [step('s1', 'outer'), call('s2', 'b1'), done('s4', 'b1')], gone: [step('s6', 'lost'), call('s7', 'orphanChild')] };
    expect(order(historyFrom(main, subs).events as never)).toEqual([
      'user', 'tool_use:a1', 'agent:a1:agent', 'a1:outer', 'tool_use:b1', 'agent:b1:agent', 'b1:inner', 'tool_result:s4:0', 'tool_result:r1:0', 'result',
      'gone:lost', 'tool_use:orphanChild', 'agent:orphanChild:agent', 'orphanChild:deep',
    ]);
  });

  it('keeps every sub-agent step exactly once', () => {
    const main = [call('c1', 'a1'), call('c2', 'a1')];
    const events = historyFrom(main, { a1: [step('s1', 'once')] }).events;
    expect(events.filter((e) => e.kind === 'assistant' && e.text === 'once')).toHaveLength(1);
  });
});

describe('subagentMessages', () => {
  it('keeps every parallel tool call and result, not only one parent chain', async () => {
    const sid = '11111111-2222-4333-8444-000000000002';
    const cwd = '/tmp/proj-subs';
    const dir = path.join(projectDir(cwd), sid, 'subagents');
    const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const e = (n: number, parent: number | null, type: string, content: unknown) => ({ type, uuid: u(n), parentUuid: parent && u(parent), sessionId: sid, agentId: 'a1', isSidechain: true, timestamp: new Date(1_800_000_000_000 + n * 1000).toISOString(), message: { id: type === 'assistant' ? 'msg1' : undefined, role: type, content } });
    const call = (n: number, parent: number, id: string) => e(n, parent, 'assistant', [{ type: 'tool_use', id, name: 'Agent', input: {} }]);
    const result = (n: number, parent: number, id: string) => e(n, parent, 'user', [{ type: 'tool_result', tool_use_id: id, content: 'ok' }]);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(projectDir(cwd), `${sid}.jsonl`), lines({ type: 'user', uuid: u(99), parentUuid: null, sessionId: sid, timestamp: new Date(1_800_000_000_000).toISOString(), message: { role: 'user', content: 'hi' } }));
    await writeFile(path.join(dir, 'agent-a1.meta.json'), JSON.stringify({ toolUseId: 'top' }));
    await writeFile(path.join(dir, 'agent-a1.jsonl'), lines(e(1, null, 'user', 'go'), call(2, 1, 'a'), call(3, 2, 'b'), call(4, 3, 'c'), result(5, 2, 'a'), result(6, 4, 'c'), result(7, 3, 'b')));
    const { subs } = await subagentMessages(cwd, sid);
    const ids = (type: string) => subs.top.flatMap((m) => [(m.message as any).content].flat().flatMap((b: any) => (b?.type === type ? [b.id ?? b.tool_use_id] : [])));
    expect(ids('tool_use').sort()).toEqual(['a', 'b', 'c']);
    expect(ids('tool_result').sort()).toEqual(['a', 'b', 'c']);
  });
});
