import { describe, expect, it } from 'bun:test';
import { findScope, type FindFocus, type FindScope } from './findScope';
import type { List } from '../../codex/view';

describe('findScope', () => {
  const cases: [string, FindFocus, boolean, boolean, List | null, FindScope][] = [
    ['terminal', 'terminal', true, false, 'today', null],
    ['file editor', 'editor', true, true, 'tasks', null],
    ['sidebar with a chat', 'sidebar', true, false, 'today', 'chat'],
    ['composer', 'chat', true, true, 'tasks', 'chat'],
    ['Codex Tasks', 'codex', true, true, 'tasks', 'tasks'],
    ['wiki index', 'codex', true, true, 'wiki', 'wiki'],
    ['a wiki page', 'codex', true, true, null, 'search'],
    ['Codex Meetings', 'codex', true, true, 'meetings', 'search'],
    ['Codex shown and no chat', 'none', false, true, 'tasks', 'tasks'],
    ['nothing focused with Codex and a chat', 'none', true, true, 'tasks', 'chat'],
    ['nothing shown', 'none', false, false, 'today', null],
  ];
  for (const [name, focus, chatShown, codexShown, list, expected] of cases) it(name, () => expect(findScope({ focus, chatShown, codexShown, list })).toBe(expected));
});
