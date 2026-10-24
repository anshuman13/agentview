import { describe, expect, it } from 'vitest';
import { clipInput, historyFrom, toolUseEvent } from './transcript.js';
import { editCount } from '../../shared/edits.js';

const msg = (uuid: string, type: string, content: unknown) => ({ type, uuid, session_id: 's', parent_tool_use_id: null, timestamp: '2026-10-15T10:00:00Z', message: { content } }) as never;
const history = () => [
  msg('u1', 'user', 'first question'),
  msg('a1', 'assistant', [{ type: 'text', text: 'thinking' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }]),
  msg('u2', 'user', [{ type: 'tool_result', tool_use_id: 't1', content: 'a b' }]),
  msg('a2', 'assistant', [{ type: 'text', text: 'done' }]),
  msg('u3', 'user', 'second question'),
];

describe('historyFrom ids', () => {
  it('gives the same ids on every rebuild and never repeats one', () => {
    const a = historyFrom(history()).events.map((e) => e.id);
    const b = historyFrom(history()).events.map((e) => e.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
    expect(a).toContain('u1:0');
    expect(a).toContain('t1');
    expect(a).toContain('a2:result');
  });
});

describe('clipInput', () => {
  const file = Array.from({ length: 500 }, (_, i) => `line ${i} ${'x'.repeat(20)}`).join('\n');

  it('leaves short values alone', () => {
    expect(clipInput({ command: 'ls', n: 3, list: ['a'] })).toEqual({ command: 'ls', n: 3, list: ['a'] });
  });

  it('cuts long strings and keeps the edit line count exact', () => {
    const full = editCount('Write', { file_path: 'a.ts', content: file });
    const e = toolUseEvent('t', 'Write', { file_path: 'a.ts', content: file }, 0) as Extract<ReturnType<typeof toolUseEvent>, { kind: 'tool_use' }>;
    expect((e.input.content as string).length).toBeLessThan(5000);
    expect(e.input.content).toMatch(/… \d+ more lines$/);
    expect(editCount('Write', e.input)).toEqual(full);
    const edit = toolUseEvent('t', 'Edit', { file_path: 'a.ts', old_string: file, new_string: `${file}\nmore` }, 0) as typeof e;
    expect(editCount('Edit', edit.input)).toEqual(editCount('Edit', { old_string: file, new_string: `${file}\nmore` }));
  });

  it('marks a long single line without adding a line', () => {
    const one = 'y'.repeat(6000);
    const e = toolUseEvent('t', 'Write', { file_path: 'a.ts', content: one }, 0) as Extract<ReturnType<typeof toolUseEvent>, { kind: 'tool_use' }>;
    expect(e.input.content).toMatch(/ …$/);
    expect(editCount('Write', e.input)).toEqual({ add: 1, del: 0 });
  });
});
