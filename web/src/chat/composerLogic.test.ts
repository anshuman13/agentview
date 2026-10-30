import { afterEach, describe, expect, it, vi } from 'vitest';
import { accept, addUse, buildHistory, filesEdited, ghostFor, rankCommands, rankFiles, remember, sharedTask, terminalId, triggerAt, turnEnd, withUses } from './composerLogic';
import type { ChatEvent } from '../../../shared/protocol';

let n = 0;
const user = (text: string): ChatEvent => ({ id: `u${++n}`, kind: 'user', text, at: n });
const tool = (name: string, input: Record<string, unknown>): ChatEvent => ({ id: `t${++n}`, kind: 'tool_use', name, input, summary: name, at: n });

describe('triggerAt', () => {
  it('finds a slash command at the start of a word', () => {
    expect(triggerAt('/', 1)).toEqual({ kind: 'command', start: 0, query: '' });
    expect(triggerAt('/comp', 5)).toEqual({ kind: 'command', start: 0, query: 'comp' });
    expect(triggerAt('run /co', 7)).toEqual({ kind: 'command', start: 4, query: 'co' });
  });

  it('finds a file mention and keeps the slashes in the query', () => {
    expect(triggerAt('fix @src/store.ts', 17)).toEqual({ kind: 'file', start: 4, query: 'src/store.ts' });
  });

  it('looks at the word under the caret only', () => {
    expect(triggerAt('/compact now', 12)).toBeNull();
    expect(triggerAt('/compact now', 5)).toEqual({ kind: 'command', start: 0, query: 'comp' });
    expect(triggerAt('a/b', 3)).toBeNull();
    expect(triggerAt('mail@me', 7)).toBeNull();
  });

  it('treats a leading bang as shell mode', () => {
    expect(triggerAt('!ls -la', 7)).toEqual({ kind: 'shell' });
    expect(triggerAt('say hi!', 7)).toBeNull();
  });
});

describe('rankCommands', () => {
  const cmds = [{ name: 'add-dir' }, { name: 'compact' }, { name: 'config' }, { name: 'cost' }, { name: 'doctor' }];
  it('puts prefix matches first and marks the matched characters', () => {
    const r = rankCommands(cmds, 'co');
    expect(r.slice(0, 3).map((x) => x.item.name).sort()).toEqual(['compact', 'config', 'cost']);
    expect(r[3]).toMatchObject({ item: { name: 'doctor' }, hits: [2, 4] });
    expect(r[0].hits).toEqual([0, 1]);
  });

  it('shows everything for an empty query, capped at the row limit', () => {
    expect(rankCommands(cmds, '')).toHaveLength(5);
    expect(rankCommands(cmds, '', 2)).toHaveLength(2);
  });

});

describe('rankFiles', () => {
  it('favours the file name over the folder', () => {
    const r = rankFiles(['web/src/store.ts', 'store/web.ts', 'docs/notes.md'], 'web');
    expect(r.map((x) => x.item)).toEqual(['store/web.ts', 'web/src/store.ts']);
  });
});

describe('accept', () => {
  it('replaces the token under the caret and adds a space', () => {
    expect(accept('/comp', 0, 5, '/compact')).toEqual({ text: '/compact ', caret: 9 });
    expect(accept('fix @sto please', 4, 8, '@src/store.ts')).toEqual({ text: 'fix @src/store.ts  please', caret: 18 });
  });
});

describe('buildHistory', () => {
  it('lists this chat newest first, then stored prompts, without repeats or blanks', () => {
    const h = buildHistory([user('first'), user('  '), user('second')], ['old', 'first', 'other']);
    expect(h).toEqual(['second', 'first', 'other', 'old']);
  });
});

describe('ghostFor', () => {
  const history = ['run the tests', 'run the linter', 'ru'];
  it('completes from the most recent matching prompt once three characters are typed', () => {
    expect(ghostFor('run', history)).toBe(' the tests');
    expect(ghostFor('run the l', history)).toBe('inter');
  });

  it('stays quiet for short or complete text', () => {
    expect(ghostFor('ru', history)).toBe('');
    expect(ghostFor('run the tests', history)).toBe('');
    expect(ghostFor('nothing', history)).toBe('');
  });
});

describe('remember', () => {
  it('moves a repeated prompt to the end and keeps the last 50', () => {
    expect(remember('a', ['a', 'b'])).toEqual(['b', 'a']);
    const many = Array.from({ length: 50 }, (_, i) => `p${i}`);
    const r = remember('new', many);
    expect(r).toHaveLength(50);
    expect(r[0]).toBe('p1');
    expect(r.at(-1)).toBe('new');
  });
});

describe('filesEdited', () => {
  it('counts distinct paths across the edit tools only', () => {
    const events = [
      tool('Edit', { file_path: '/a.ts' }),
      tool('Write', { file_path: '/b.ts' }),
      tool('MultiEdit', { file_path: '/a.ts' }),
      tool('Read', { file_path: '/c.ts' }),
      tool('Edit', {}),
      user('ok'),
    ];
    expect(filesEdited(events)).toBe(2);
    expect(filesEdited([])).toBe(0);
  });
});

describe('turnEnd', () => {
  const say = (text: string, parent?: string): ChatEvent => ({ id: `a${++n}`, kind: 'assistant', text, streaming: false, at: n, parent });
  it('reads the last top-level reply of the current turn only', () => {
    expect(turnEnd([user('a'), say('old'), user('b'), say('new'), say('sub', 't1')])).toBe('Claude: new');
    expect(turnEnd([user('a'), say('old'), user('b')])).toBe('Claude finished');
  });
});

describe('addUse', () => {
  it('keeps one entry per server, narrowing to tools or widening back', () => {
    const docs = { server: 'claude.ai Claude Docs' };
    const read = { server: 'claude.ai Claude Docs', tool: 'read' };
    const query = { server: 'claude.ai Claude Docs', tool: 'query' };
    expect(addUse([], docs)).toEqual([docs]);
    expect(addUse([docs], docs)).toEqual([docs]);
    expect(addUse([docs], read)).toEqual([read]);
    expect(addUse([read], query)).toEqual([read, query]);
    expect(addUse([read, query], read)).toEqual([query, read]);
    expect(addUse([read, query], docs)).toEqual([docs]);
    expect(addUse([read], { server: 'chrome' })).toEqual([read, { server: 'chrome' }]);
  });
});

describe('withUses', () => {
  it('appends one line naming the servers and tools, except on slash commands', () => {
    expect(withUses('summarise it', [])).toBe('summarise it');
    expect(withUses('summarise it', [{ server: 'claude.ai Claude Docs' }])).toBe('summarise it\n\nUse the claude.ai Claude Docs MCP server for this.');
    expect(withUses('go', [{ server: 'claude.ai Claude Docs', tool: 'read' }, { server: 'chrome' }, { server: 'chrome', tool: 'navigate' }])).toBe(
      'go\n\nUse the mcp__claude_ai_Claude_Docs__read tool, the chrome MCP server and the mcp__chrome__navigate tool for this.',
    );
    expect(withUses('/compact', [{ server: 'chrome' }])).toBe('/compact');
  });
});

describe('terminalId', () => {
  const res = (ok: boolean, body: unknown) => ({ ok, json: async () => body });
  const url = (p: string) => p;
  afterEach(() => vi.unstubAllGlobals());

  it('creates a terminal when none exist', async () => {
    const f = vi.fn().mockResolvedValueOnce(res(true, [])).mockResolvedValueOnce(res(true, { id: 'n' }));
    vi.stubGlobal('fetch', f);
    expect(await terminalId(url)).toBe('n');
    expect(f.mock.calls[1][1]).toEqual({ method: 'POST' });
  });

  it('returns null on a failed response, a missing id or a rejected fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(false, {})));
    expect(await terminalId(url)).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(res(true, [])).mockResolvedValueOnce(res(true, {})));
    expect(await terminalId(url)).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    expect(await terminalId(url)).toBeNull();
  });
});

describe('sharedTask', () => {
  it('keeps the link in the title and reads a time', () => {
    const now = new Date(2026, 9, 30, 8, 0);
    expect(sharedTask(' Read https://example.com/a?b=1 ', now)).toEqual({ title: 'Read https://example.com/a?b=1', at: null });
    const r = sharedTask('Call back tomorrow at 3pm https://example.com', now);
    expect(r.at).toBe(new Date(2026, 9, 31, 15, 0).getTime());
    expect(r.title).toBe('Call back https://example.com');
  });
});
