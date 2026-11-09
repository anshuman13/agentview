import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ChatEvent, ServerMessage } from '../../../../shared/protocol.js';
import { historyEvents, splitDiff } from './events.js';
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
  const stream = new CodexStream({
    cwd: '/tmp/proj',
    pushEvent: (ev) => void events.push(ev),
    emit: (m) => void emitted.push(m),
    system: () => undefined,
    setSession: (p) => void session.push(p),
    turnResult: (r) => void results.push(r),
    noteFile: (rel) => void noted.push(rel),
    captureEdit: (f) => void captured.push(f),
  });
  for (const l of lines) stream.handle(l.method, l.params);
  return { events, emitted, noted, captured, results, session, stream };
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
    expect(results).toEqual([{ id: 'turn1:result', ok: true, text: 'Added the greeting.', costUsd: 0, isError: false }]);
    expect(session).toEqual([{ context: 1234 }]);
  });

  it('reports a failed turn with its error', () => {
    const { stream, results } = run();
    results.length = 0;
    stream.handle('turn/completed', { turn: { id: 'turn2', status: 'failed', error: { message: 'usage limit' }, items: [] } });
    expect(results).toEqual([{ id: 'turn2:result', ok: false, text: 'usage limit', costUsd: 0, isError: true }]);
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
});

describe('splitDiff', () => {
  it('ignores the context lines and file headers', () => {
    expect(splitDiff('--- a\n+++ b\n@@ -1,2 +1,2 @@\n keep\n-old\n+new\n')).toEqual({ before: 'old', after: 'new' });
  });
});
