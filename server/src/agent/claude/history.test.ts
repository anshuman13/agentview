import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const config = await mkdtemp(path.join(os.tmpdir(), 'av-wf-'));
process.env.CLAUDE_CONFIG_DIR = config;
const { parseJournal, projectDir, workflowAgents, workflowSize } = await import('./history.js');
const { historyFrom, workflowName } = await import('./transcript.js');

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
    expect(workflowName({ scriptPath: 'x' })).toBe('Workflow');
  });
});
