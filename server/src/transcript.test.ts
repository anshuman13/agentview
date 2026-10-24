import { describe, expect, it } from 'vitest';
import { cacheFrom, clipInput, historyFrom, toolResultText, toolUseEvent, usageFrom } from './transcript.js';
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

describe('usageFrom', () => {
  it('reads the usage trailer of an agent report', () => {
    expect(usageFrom('Report\nagentId: a1\n<usage>total_tokens: 50\ntool_uses: 3\nduration_ms: 6000</usage>')).toEqual({ tokens: 50, toolUses: 3, durationMs: 6000 });
    expect(usageFrom('<usage>subagent_tokens: 7 tool_uses: 0 duration_ms: 1</usage>')).toEqual({ tokens: 7, toolUses: 0, durationMs: 1 });
  });

  it('gives null without a complete trailer', () => {
    expect(usageFrom('Report')).toBeNull();
    expect(usageFrom('<usage>total_tokens: 50</usage>')).toBeNull();
  });
});

describe('toolResultText', () => {
  it('takes a string as is', () => {
    expect(toolResultText({ content: 'ok' })).toBe('ok');
  });

  it('joins the text blocks and skips the rest', () => {
    expect(toolResultText({ content: [{ type: 'text', text: 'a' }, { type: 'image', source: {} }, { type: 'text', text: 'b' }] })).toBe('a\n\nb');
  });

  it('is empty without content', () => {
    expect(toolResultText({})).toBe('');
  });
});

describe('cacheFrom', () => {
  it('keeps the previous info when the message has no usage', () => {
    const prev = { at: 1, ttlMs: 300_000, readTokens: 10, writeTokens: 0 };
    expect(cacheFrom(undefined, 2, prev)).toBe(prev);
    expect(cacheFrom(undefined, 2, null)).toBeNull();
  });

  it('reads the token counts and picks the ttl from the cache creation', () => {
    expect(cacheFrom({ cache_read_input_tokens: 100, cache_creation_input_tokens: 20, cache_creation: { ephemeral_1h_input_tokens: 20 } }, 5, null)).toEqual({ at: 5, ttlMs: 3_600_000, readTokens: 100, writeTokens: 20 });
    expect(cacheFrom({ cache_creation: { ephemeral_5m_input_tokens: 3 } }, 5, null)).toEqual({ at: 5, ttlMs: 300_000, readTokens: 0, writeTokens: 0 });
  });

  it('keeps the earlier ttl when nothing new was cached', () => {
    const prev = { at: 1, ttlMs: 3_600_000, readTokens: 10, writeTokens: 10 };
    expect(cacheFrom({ cache_read_input_tokens: 40 }, 9, prev)).toEqual({ at: 9, ttlMs: 3_600_000, readTokens: 40, writeTokens: 0 });
    expect(cacheFrom({ cache_read_input_tokens: 40 }, 9, null)?.ttlMs).toBe(300_000);
  });
});
