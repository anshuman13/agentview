import { describe, expect, it } from 'vitest';
import { buildCommands, matchCommand, rankCommands, remember } from './Palette';

const models = [{ value: 'claude-opus-4-1', displayName: 'Opus 4.1' }, { value: 'claude-sonnet-4-5', displayName: 'Sonnet 4.5' }];
const cmds = buildCommands(models);
const ids = (rows: ReturnType<typeof rankCommands>) => rows.map((r) => r.cmd.id);

describe('buildCommands', () => {
  it('lists views, tabs, one entry per model and per permission mode', () => {
    expect(ids(rankCommands(cmds, '', [], 100))).toEqual(expect.arrayContaining(['view:explorer', 'page:deploy', 'tab:chat', 'tab:browser', 'tab:agents', 'switchEditor', 'model:claude-opus-4-1', 'model:claude-sonnet-4-5', 'mode:default', 'mode:dontAsk', 'terminal', 'newChat', 'compact', 'stop', 'theme', 'notify', 'phone']));
  });
});

describe('matchCommand', () => {
  it('matches everything on an empty query', () => {
    expect(matchCommand('View: Show Explorer', '  ')).toEqual({ score: 0, hits: [] });
  });

  it('prefers a word-start substring over one inside a word', () => {
    const start = matchCommand('View: Show Explorer', 'show')!;
    const inside = matchCommand('View: Showcase', 'how')!;
    expect(start.hits).toEqual([6, 7, 8, 9]);
    expect(start.score).toBeGreaterThan(inside.score);
  });

  it('matches each query word independently', () => {
    const m = matchCommand('View: Show Source Control', 'view control')!;
    expect(m.hits).toEqual([0, 1, 2, 3, 18, 19, 20, 21, 22, 23, 24]);
    expect(matchCommand('View: Show Source Control', 'view github')).toBeNull();
  });

  it('falls back to a subsequence match and scores it below a substring', () => {
    const sub = matchCommand('Chat: Compact Context', 'cct')!;
    expect(sub.hits).toEqual([0, 6, 12]);
    expect(sub.score).toBeLessThan(matchCommand('Chat: Compact Context', 'compact')!.score);
    expect(matchCommand('Chat: Stop Claude', 'xyz')).toBeNull();
  });
});

describe('rankCommands', () => {
  it('keeps definition order and caps at 12 rows without a query', () => {
    const rows = rankCommands(cmds, '', []);
    expect(rows).toHaveLength(12);
    expect(ids(rows).slice(0, 2)).toEqual(['view:explorer', 'view:changes']);
    expect(rows.every((r) => !r.recent)).toBe(true);
  });

  it('puts recently used commands first, most recent on top', () => {
    const rows = rankCommands(cmds, '', ['stop', 'terminal']);
    expect(ids(rows).slice(0, 3)).toEqual(['stop', 'terminal', 'view:explorer']);
    expect(rows.map((r) => r.recent).slice(0, 3)).toEqual([true, true, false]);
  });

  it('filters by the query and sorts the best match first', () => {
    const rows = rankCommands(cmds, 'explorer', []);
    expect(ids(rows)[0]).toBe('view:explorer');
    expect(ids(rankCommands(cmds, 'model', []))).toEqual(['model:claude-opus-4-1', 'model:claude-sonnet-4-5', 'mode:default', 'mode:plan']);
  });

  it('keeps recent matches ahead of other matches', () => {
    const rows = rankCommands(cmds, 'view', ['page:deploy']);
    expect(ids(rows)[0]).toBe('page:deploy');
    expect(ids(rows)).not.toContain('stop');
  });

  it('returns nothing when no command matches', () => {
    expect(rankCommands(cmds, 'qqqqq', [])).toEqual([]);
  });
});

describe('remember', () => {
  it('moves the id to the front, dedupes and caps the list', () => {
    expect(remember(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
    expect(remember(['a', 'b'], 'c', 2)).toEqual(['c', 'a']);
  });
});
