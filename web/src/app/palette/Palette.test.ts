import { describe, expect, it } from 'vitest';
import { buildCommands, itemKey, matchCommand, paletteItems, pinCommands, rankCommands, rankItems, recentItems, remember, seeAllCount, type PaletteItem } from './paletteLogic';

const models = [{ value: 'claude-opus-4-1', displayName: 'Opus 4.1' }, { value: 'claude-sonnet-4-5', displayName: 'Sonnet 4.5' }];
const cmds = buildCommands(models, true);
const ids = (rows: ReturnType<typeof rankCommands>) => rows.map((r) => r.cmd.id);

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
  it('lists Deploy only when it is set up', () => {
    expect(buildCommands(models, false).map((c) => c.id)).not.toContain('page:deploy');
    expect(buildCommands(models, true).map((c) => c.id)).toContain('page:deploy');
  });
  it('offers the Codex views', () => {
    expect(ids(rankCommands(cmds, 'tasks', []))).toContain('codex:tasks');
  });
});

describe('pinned chats', () => {
  const pinned = pinCommands(['s2', 'gone', 's1'], [{ sessionId: 's1', title: 'Stop Claude' }], [{ sessionId: 's2', title: 'Fix login' }]);
  const all = [...cmds, ...pinned];

  it('lists chats that exist, capped at 20', () => {
    expect(pinned.map((c) => c.id)).toEqual(['pin:s2', 'pin:s1']);
    const many = Array.from({ length: 25 }, (_, i) => ({ sessionId: `s${i}`, title: `c${i}` }));
    expect(pinCommands(many.map((c) => c.sessionId), [], many)).toHaveLength(20);
  });

  it('sorts before recent commands with an empty query', () => {
    expect(ids(rankCommands(all, '', ['stop'], 14)).slice(0, 3)).toEqual(['pin:s2', 'pin:s1', 'stop']);
  });

  it('ranks above an equal match with a query', () => {
    expect(ids(rankCommands(all, 'chat: stop claude', [])).slice(0, 2)).toEqual(['pin:s1', 'stop']);
  });
});

describe('remember', () => {
  it('moves the id to the front, dedupes and caps the list', () => {
    expect(remember(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
    expect(remember(['a', 'b'], 'c', 2)).toEqual(['c', 'a']);
  });
});

describe('palette items', () => {
  const base = { version: 1, updated_at: 0, deleted: 0, field_times: '{}', dirty: 0 };
  const data = {
    items: [
      { ...base, id: 't1', profile: 'work', title: 'Ship report', text: 'body', status: 'open' },
      { ...base, id: 't2', profile: 'work', title: 'Ship dismissed', status: 'dismissed' },
      { ...base, id: 't3', profile: 'work', title: 'Ship deleted', status: 'open', deleted: 1 },
      { ...base, id: 't4', profile: 'personal', title: null, text: 'Ship done text', status: 'done' },
    ],
    meetings: [
      { ...base, id: 'm1', profile: 'work', title: 'Ship sync', starts_at: 1, state: null },
      { ...base, id: 'block:1', profile: 'work', title: 'Ship block', starts_at: 1, state: null },
      { ...base, id: 'm2', profile: 'work', title: 'Ship gone', starts_at: 1, state: null, deleted: 1 },
    ],
    pages: [{ ...base, id: 'p1', profile: 'work', title: null, state: null }],
  } as unknown as Parameters<typeof paletteItems>[0];
  const items = paletteItems(data);

  it('lists live tasks, meetings without blocks and pages', () => {
    expect(items.map(itemKey)).toEqual(['task:work:t1', 'task:personal:t4', 'meeting:work:m1', 'wiki:work:p1']);
    expect(items.map((i) => i.title)).toEqual(['Ship report', 'Ship done text', 'Ship sync', 'Untitled']);
  });

  it('matches titles only', () => {
    expect(rankItems(items, 'body', [])).toEqual([]);
  });

  it('puts recent matches first, then best match, and caps at 8', () => {
    expect(rankItems(items, 'ship', ['meeting:work:m1']).map((r) => r.item.id)[0]).toBe('m1');
    const many: PaletteItem[] = Array.from({ length: 12 }, (_, i) => ({ kind: 'task', profile: 'work', id: `x${i}`, title: `Task ${i}`, at: null }));
    expect(rankItems(many, 'task', [])).toHaveLength(8);
  });

  it('lists recent items in order, skipping gone ones, capped at 5', () => {
    expect(recentItems(items, ['gone', 'wiki:work:p1', 'task:work:t1']).map((r) => r.item.id)).toEqual(['p1', 't1']);
    const keys = items.map(itemKey);
    expect(recentItems(items, [...keys, ...keys], 3)).toHaveLength(3);
  });

  it('dedupes stored item keys', () => {
    expect(remember(['a', 'b', 'c'], 'c', 5)).toEqual(['c', 'a', 'b']);
  });
});

describe('seeAllCount', () => {
  const base = { deleted: 0, created_at: 0, updated_at: 0 };
  const data = {
    items: [
      { ...base, id: 't1', profile: 'work', title: 'Plan', text: 'zebra in the notes', status: 'open' },
      { ...base, id: 't2', profile: 'personal', title: 'Buy food', text: 'zebra', status: 'open' },
    ],
    meetings: [
      { ...base, id: 'm1', profile: 'work', title: 'Sync', summary: 'zebra count', starts_at: 1, state: null },
      { ...base, id: 'block:t1', profile: 'work', title: 'zebra block', starts_at: 1, state: null },
    ],
    facts: [],
    pages: [],
    jobs: [{ ...base, id: 'j1', profile: 'work', name: 'Digest', prompt: 'list each zebra' }],
  } as unknown as Parameters<typeof seeAllCount>[0];

  it('counts tasks, meetings and jobs matching the query', () => {
    expect(seeAllCount(data, 'all', 'zebra')).toBe(4);
  });

  it('is 0 without a match or with a blank query', () => {
    expect(seeAllCount(data, 'all', 'giraffe')).toBe(0);
    expect(seeAllCount(data, 'all', '  ')).toBe(0);
  });

  it('respects the profile filter', () => {
    expect(seeAllCount(data, 'personal', 'zebra')).toBe(1);
    expect(seeAllCount(data, 'work', 'zebra')).toBe(3);
  });

  it('counts wiki facts', () => {
    const withFact = { ...data, pages: [{ ...base, id: 'p1', profile: 'work', title: 'Animals', summary: '', state: null }], facts: [{ ...base, id: 'f1', profile: 'work', page_id: 'p1', text: 'The zebra is striped', state: null }] } as unknown as Parameters<typeof seeAllCount>[0];
    expect(seeAllCount(withFact, 'all', 'zebra')).toBeGreaterThan(4);
  });
});
