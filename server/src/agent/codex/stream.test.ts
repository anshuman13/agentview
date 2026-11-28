import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'bun:test';
import type { ChatEvent, ServerMessage } from '../../../../shared/protocol.js';
import { historyEvents, planEvents, rolloutPlan, splitDiff } from './events.js';
import type { ThreadItem } from './protocol.js';
import { CodexStream } from './stream.js';

// Notifications as `codex app-server` writes them, one per line.
const lines = readFileSync(new URL('./fixtures/turn.jsonl', import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { method: string; params: any });

function run() {
  const events: ChatEvent[] = [];
  const emitted: ServerMessage[] = [];
  const noted: string[] = [];
  const captured: string[] = [];
  const results: unknown[] = [];
  const session: unknown[] = [];
  const limits: number[] = [];
  const stream = new CodexStream({
    cwd: '/tmp/proj',
    state: { session: { usage: { fiveHour: { pct: 100, resetsAt: 1_900_000_000_000 }, week: { pct: 40, resetsAt: 1_900_500_000_000 } } } } as never,
    limit: (until) => void limits.push(until),
    pushEvent: (ev) => void events.push(ev),
    emit: (m) => void emitted.push(m),
    system: () => undefined,
    setSession: (p) => void session.push(p),
    turnResult: (r) => void results.push(r),
    compacted: () => undefined,
    noteFile: (rel) => void noted.push(rel),
    captureEdit: (f) => void captured.push(f),
  });
  for (const l of lines) stream.handle(l.method, l.params);
  return { events, emitted, noted, captured, results, session, limits, stream };
}

describe('CodexStream', () => {
  it('maps a command to a Bash step with its output', () => {
    const { events } = run();
    expect(events.find((e) => e.kind === 'tool_use' && e.id === 'c1')).toMatchObject({ name: 'Bash', input: { command: 'ls src' } });
    expect(events.find((e) => e.kind === 'tool_result' && e.toolUseId === 'c1')).toMatchObject({ text: 'main.ts\n', isError: false });
  });

  it('maps file changes to an Edit with the removed and added lines and a Write for a new file', () => {
    const { events, noted, captured } = run();
    expect(events.find((e) => e.id === 'f1:0')).toMatchObject({ name: 'Edit', input: { file_path: '/tmp/proj/src/main.ts', old_string: 'console.log(a);', new_string: "console.log('hello', a);\nconsole.log('done');" } });
    expect(events.find((e) => e.id === 'f1:1')).toMatchObject({ name: 'Write', input: { content: "export const hello = 'hi';\n" } });
    expect(noted).toEqual(['src/main.ts', 'src/hello.ts']);
    expect(captured).toEqual(['/tmp/proj/src/main.ts', '/tmp/proj/src/hello.ts']);
  });

  it('maps an MCP call to a namespaced step and a failed call to an error result', () => {
    const { events } = run();
    expect(events.find((e) => e.id === 'm1')).toMatchObject({ name: 'mcp__docs__search', input: { query: 'greeting' } });
    expect(events.find((e) => e.kind === 'tool_result' && e.toolUseId === 'm1')).toMatchObject({ text: 'server unavailable', isError: true });
  });

  it('streams the assistant text as one event, then finishes it with the full text', () => {
    const { events, emitted } = run();
    const texts = events.filter((e) => e.kind === 'assistant');
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatchObject({ id: 'a1', text: 'Added the greeting.', streaming: false });
    expect(emitted.at(-1)).toMatchObject({ type: 'event', event: { id: 'a1', streaming: false } });
  });

  it('ends the turn with the last reply and records the context size', () => {
    const { results, session } = run();
    expect(results).toEqual([{ id: 'turn1:result', ok: true, text: 'Added the greeting.', tokens: { model: '', input: 400, cachedInput: 600, cacheWrite: 40, output: 234, reasoning: 120 }, isError: false }]);
    expect(session).toEqual([{ context: 1234, contextWindow: 200000 }]);
  });

  it('reports a failed turn with its error', () => {
    const { stream, results } = run();
    results.length = 0;
    stream.handle('turn/completed', { turn: { id: 'turn2', status: 'failed', error: { message: 'usage limit' }, items: [] } });
    expect(results).toEqual([{ id: 'turn2:result', ok: false, text: 'usage limit', isError: true }]);
  });
});

describe('usage limit', () => {
  it('reports the reset of the full window when the turn hits the plan limit', () => {
    const { stream, limits } = run();
    stream.handle('error', { willRetry: false, error: { message: 'limit', codexErrorInfo: 'usageLimitExceeded' } });
    expect(limits).toEqual([1_900_000_000_000]);
    stream.handle('error', { willRetry: false, error: { message: 'other', codexErrorInfo: 'other' } });
    expect(limits).toHaveLength(1);
  });
});

describe('historyEvents', () => {
  it('rebuilds a turn from its items', () => {
    const items = lines.filter((l) => l.method === 'item/completed' || (l.method === 'item/started' && l.params.item.type === 'userMessage')).map((l) => l.params.item as ThreadItem);
    const events = historyEvents([{ id: 'turn1', items, status: 'completed', startedAt: 1794249400, error: null }], 0);
    expect(events.map((e) => e.kind)).toEqual(['user', 'tool_use', 'tool_result', 'tool_use', 'tool_use', 'tool_result', 'tool_result', 'tool_use', 'tool_result', 'assistant', 'result']);
    expect(events[0]).toMatchObject({ text: 'add a greeting', at: 1794249400000 });
    expect(events.at(-1)).toMatchObject({ id: 'turn1:result', text: 'Added the greeting.' });
  });

  it('skips Plan-mode plan items, which carry no checklist', () => {
    const items = [{ type: 'plan', id: 'p1', text: '1. Read\n2. Write' }] as ThreadItem[];
    expect(historyEvents([{ id: 't', items, status: 'completed', startedAt: 1, error: null }], 0).map((e) => e.kind)).toEqual(['result']);
  });

  it('rebuilds the checklist from the last update_plan call in the rollout file', () => {
    const saved = rolloutPlan(readFileSync(new URL('./fixtures/rollout.jsonl', import.meta.url), 'utf8'));
    expect(saved).toEqual({ turnId: 'turn2', plan: [{ step: 'Create x.txt', status: 'completed' }, { step: 'List "all" files', status: 'inProgress' }] });
    const turn = (id: string) => ({ id, items: [], status: 'completed' as const, startedAt: 1, error: null });
    const events = historyEvents([turn('turn1'), turn('turn2'), turn('turn3')], 0, saved);
    expect(events.map((e) => e.id)).toEqual(['turn1:result', 'turn2:plan:saved', 'turn2:plan:saved:result', 'turn2:result', 'turn3:result']);
    expect(events[1]).toMatchObject({ kind: 'tool_use', name: 'TodoWrite', input: { todos: [{ content: 'Create x.txt', status: 'completed' }, { content: 'List "all" files', status: 'in_progress' }] } });
    expect(historyEvents([turn('other')], 0, saved).map((e) => e.id)).toEqual(['other:plan:saved', 'other:plan:saved:result', 'other:result']);
    expect(rolloutPlan('{"type":"response_item","payload":{"type":"message","text":"update_plan"}}')).toBeNull();
  });
});

describe('reasoning', () => {
  const item = (summary: string[], content: string[] = []) => ({ type: 'reasoning', id: 'r1', summary, content }) as ThreadItem;

  it('pushes one thinking row per reasoning item from the streamed summary', () => {
    const { events, stream } = run();
    const before = events.length;
    stream.handle('item/reasoning/textDelta', { itemId: 'r1', delta: 'raw thoughts' });
    stream.handle('item/reasoning/summaryTextDelta', { itemId: 'r1', delta: '**Checking ' });
    stream.handle('item/reasoning/summaryTextDelta', { itemId: 'r1', delta: 'the tests**' });
    stream.handle('item/completed', { turnId: 't', item: item([]) });
    stream.handle('item/completed', { turnId: 't', item: { ...item([]), id: 'r2' } });
    expect(events.slice(before)).toEqual([{ id: 'r1', kind: 'thinking', text: 'Checking the tests', at: expect.any(Number) }]);
  });

  it('rebuilds thinking rows in history, summary before raw text', () => {
    const turn = (items: ThreadItem[]) => historyEvents([{ id: 't', items, status: 'inProgress', startedAt: 1, error: null }], 0);
    expect(turn([item(['Reading the spec'], ['raw'])])).toEqual([{ id: 'r1', kind: 'thinking', text: 'Reading the spec', at: 1000 }]);
    expect(turn([item([], ['Raw only'])])).toMatchObject([{ text: 'Raw only' }]);
    expect(turn([item([], [])])).toEqual([]);
  });
});

describe('turn/plan/updated', () => {
  it('pushes each plan update as its own TodoWrite step', () => {
    const { events, stream } = run();
    const before = events.length;
    const plan = (status: string) => stream.handle('turn/plan/updated', { threadId: 'th', turnId: 'turn2', explanation: null, plan: [{ step: 'Write the code', status }] });
    plan('inProgress');
    plan('completed');
    const steps = events.slice(before).filter((e) => e.kind === 'tool_use');
    expect(steps.map((e) => e.id)).toEqual(['turn2:plan:0', 'turn2:plan:1']);
    expect(steps[1]).toMatchObject({ name: 'TodoWrite', input: { todos: [{ content: 'Write the code', status: 'completed' }] } });
  });
});

describe('splitDiff', () => {
  it('ignores the context lines and file headers', () => {
    expect(splitDiff('--- a\n+++ b\n@@ -1,2 +1,2 @@\n keep\n-old\n+new\n')).toEqual({ before: 'old', after: 'new' });
  });
});

describe('planEvents', () => {
  it('maps an update_plan checklist onto a TodoWrite step with its result', () => {
    const events = planEvents('t1', 2, [
      { step: 'Read the spec', status: 'completed' },
      { step: 'Write the code', status: 'inProgress' },
      { step: 'Run the checks', status: 'pending' },
    ], 5);
    expect(events[0]).toMatchObject({
      kind: 'tool_use',
      id: 't1:plan:2',
      name: 'TodoWrite',
      input: {
        todos: [
          { content: 'Read the spec', activeForm: 'Read the spec', status: 'completed' },
          { content: 'Write the code', activeForm: 'Write the code', status: 'in_progress' },
          { content: 'Run the checks', activeForm: 'Run the checks', status: 'pending' },
        ],
      },
    });
    expect(events[1]).toMatchObject({ kind: 'tool_result', toolUseId: 't1:plan:2', isError: false });
  });
});
