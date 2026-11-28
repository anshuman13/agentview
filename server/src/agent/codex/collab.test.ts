import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'bun:test';
import type { AgentEvent, ChatEvent } from '../../../../shared/protocol.js';
import type { CollabItem } from './protocol.js';
import { CodexStream } from './stream.js';

const lines = readFileSync(new URL('./fixtures/collab.jsonl', import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { method: string; params: any });

function sink() {
  const events: ChatEvent[] = [];
  const results: unknown[] = [];
  const session: unknown[] = [];
  const agents = () => events.filter((e): e is AgentEvent => e.kind === 'agent').map((a) => ({ ...a }));
  const stream = new CodexStream({
    cwd: '/tmp/proj',
    state: { session: {} } as never,
    limit: () => undefined,
    pushEvent: (ev) => void events.push(ev),
    emit: () => undefined,
    system: () => undefined,
    setSession: (p) => void session.push(p),
    turnResult: (r) => void results.push(r),
    compacted: () => undefined,
    noteFile: () => undefined,
    captureEdit: () => undefined,
    agentOf: (id) => events.find((e): e is AgentEvent => e.kind === 'agent' && e.toolUseId === id),
  });
  return { events, results, session, agents, stream };
}

const collab = (id: string, tool: CollabItem['tool'], states: CollabItem['agentsStates'] = {}, receivers = ['a1']): CollabItem => ({
  type: 'collabAgentToolCall', id, tool, status: 'completed', senderThreadId: 't1', receiverThreadIds: receivers, prompt: tool === 'spawnAgent' ? 'Check it' : null, agentsStates: states,
});

function spawned() {
  const s = sink();
  s.stream.handle('item/started', { threadId: 't1', item: collab('s1', 'spawnAgent') });
  return s;
}

const endedBy = (status: string) => {
  const s = spawned();
  s.stream.handle('item/completed', { threadId: 't1', item: collab('w1', 'wait', { a1: { status: status as never, message: status === 'errored' ? 'boom' : null } }) });
  return s;
};

describe('CodexCollab', () => {
  it('turns a spawn, a wait and a completed agent into one running and then one done agent', () => {
    const { events, agents, stream, results, session } = sink();
    let running: AgentEvent[] = [];
    for (const l of lines) {
      stream.handle(l.method, l.params);
      if (l.params.item?.id === 'w1' && l.method === 'item/started') running = agents();
    }
    expect(running).toHaveLength(1);
    expect(running[0]).toMatchObject({ toolUseId: 's1', status: 'running', description: 'Find the failing test', model: 'gpt-5.5 high', endedAt: null });
    const done = agents();
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ status: 'done', endedAt: expect.any(Number) });
    expect(events.find((e) => e.id === 's1')).toMatchObject({ kind: 'tool_use', name: 'Agent', input: { description: 'Find the failing test' } });
    expect(events.filter((e) => e.kind === 'tool_result' && e.toolUseId === 's1')).toMatchObject([{ text: 'stream.test.ts fails on line 12.', isError: false }]);
    // The child's steps nest under the spawn, including the one that came before the spawn named its thread.
    expect(events.find((e) => e.id === 'ac1')).toMatchObject({ kind: 'tool_use', name: 'Bash', parent: 's1' });
    expect(events.find((e) => e.kind === 'tool_result' && e.toolUseId === 'ac1')).toMatchObject({ parent: 's1', isError: true });
    expect(events.find((e) => e.id === 'am1')).toMatchObject({ kind: 'assistant', parent: 's1' });
    expect(events.find((e) => e.id === 'w1')).toMatchObject({ kind: 'tool_use', name: 'wait' });
    expect(events.some((e) => 'parent' in e && e.parent && e.parent !== 's1')).toBe(false);
    // The child's turn and usage are not the chat's.
    expect(results).toEqual([]);
    expect(session).toEqual([]);
  });

  it('maps errored to failed and interrupted and shutdown to stopped', () => {
    expect(endedBy('errored').agents()[0]).toMatchObject({ status: 'failed' });
    expect(endedBy('errored').events.find((e) => e.kind === 'tool_result' && e.toolUseId === 's1')).toMatchObject({ text: 'boom', isError: true });
    expect(endedBy('interrupted').agents()[0]).toMatchObject({ status: 'stopped' });
    expect(endedBy('shutdown').events.find((e) => e.kind === 'tool_result' && e.toolUseId === 's1')).toMatchObject({ stopped: true, isError: false });
    expect(endedBy('running').agents()[0]).toMatchObject({ status: 'running', endedAt: null });
  });

  it('marks a spawn that failed to start as failed', () => {
    const s = sink();
    s.stream.handle('item/started', { threadId: 't1', item: { ...collab('s1', 'spawnAgent', {}, []), status: 'inProgress' } });
    s.stream.handle('item/completed', { threadId: 't1', item: { ...collab('s1', 'spawnAgent', {}, []), status: 'failed' } });
    expect(s.agents()[0]).toMatchObject({ status: 'failed' });
  });
});
