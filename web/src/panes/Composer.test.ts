import { describe, expect, it } from 'vitest';
import { accept, buildHistory, contextPercent, filesEdited, ghostFor, rankCommands, rankFiles, remember, triggerAt } from './Composer';
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

  it('drops commands that do not match', () => {
    expect(rankCommands(cmds, 'zzz')).toEqual([]);
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

describe('contextPercent', () => {
  it('measures against the compaction threshold', () => {
    expect(contextPercent(null)).toBeNull();
    expect(contextPercent(100_000)).toBe(50);
    expect(contextPercent(287_000)).toBe(100);
  });
});
